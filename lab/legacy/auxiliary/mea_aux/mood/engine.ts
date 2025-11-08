// src/core/mood/engine.ts
// One file exporting BOTH engines:
//  - Cascade V1 (name.vowel.number.greek.posMag)
//  - Switch+Overall V2 (mn.NUM.LETTER-W + final multiplier to apply on MEA)

export type Mn = "inj"|"drn"|"trl"|"rev"|"wnd"|"emg"|"std"|"stb"|"flo";

export interface MoodState { lastMood: "PANIC"|"BEAR"|"NEUTRAL"|"BULL"|"EUPHORIA"; lastScore: number; dwell: number; }

const clamp = (x:number, lo:number, hi:number)=>Math.max(lo, Math.min(hi, x));
const tanh  = (x:number)=>{ const e=Math.exp(2*x); return (e-1)/(e+1); };
const sgn   = (x:number)=> x>0? 1 : x<0? -1 : 0;

/* -------------------------------- Common IO -------------------------------- */

export interface CommonInputs {
  // vectors (±S)
  vTendencyScore: number;     // ±S
  vSwapScore: number;         // ±S
  vOuterScore?: number;       // ±S (optional)
  // metrics (magnitudes 0..100)
  inertia: number; disruption: number; amp: number; volt: number;
  // signed optionals (±S)
  inflDef?: number; efficiency?: number;
  // MEA conditioning (optional)
  MEA?: number; id_pct?: number;
  // GFM for GFMΔ
  gfmNow: number; gfmBaselinePersistent: number; gfmHistory?: number[]; // last = most recent
}

export interface CommonCfg {
  S?: number;                   // default 100
  iotaPct?: number;             // gfmdelt% (default 0.0058 = 0.58%)
  epsilonCycles?: number;       // persistence horizon (default 20)
  smoothAlpha?: number;         // default 0.3 (only V1 uses)
}

/* ---------------------------- Shared primitives ---------------------------- */

function gfmDeltaSignal(
  gNow:number, gBase:number, hist:number[]|undefined, iota=0.0058, eps=20
): { deltaPct:number; persistent:boolean } {
  let d = gBase!==0 ? (gNow - gBase)/gBase : 0;
  const fast = Math.max(2, Math.floor(eps*0.5)-2);
  if (hist && hist.length >= fast+1) {
    const N = hist.length, win = hist.slice(N-(fast+1), N);
    const deltas:number[] = [];
    for (let i=1;i<win.length;i++){
      const b = win[i-1] || gBase || 1;
      deltas.push((win[i]-b)/b);
    }
    const meanAbs = deltas.reduce((a,b)=>a+Math.abs(b),0)/(deltas.length||1);
    d = deltas.at(-1) ?? d;
    return { deltaPct: d, persistent: meanAbs >= iota };
  }
  return { deltaPct: d, persistent: Math.abs(d) >= iota };
}

function conditionMEA(MEA:number|undefined, id_pct:number|undefined, S:number): number {
  const m = clamp((MEA ?? 0)/S, -1, 1);
  const id= clamp((id_pct ?? 0)/S, -1, 1);
  const tilt = 1 + 0.35 * (Math.sign(m)===Math.sign(id)? 1 : -1) * Math.abs(id);
  return clamp(m * tilt, -1, 1);
}

function tierForScore(score:number, S=100){
  const x = clamp(score/S, -1, 1);
  if (x <= -0.60) return 1; if (x <= -0.20) return 2; if (x < 0.20) return 3; if (x < 0.60) return 4; return 5;
}
function rankForScore(score:number, S=100){
  const x = clamp(score/S, -1, 1);
  if (x <= -0.75) return "E"; if (x <= -0.50) return "D"; if (x <= -0.25) return "C";
  if (x < 0.25) return "B"; if (x < 0.50) return "A"; if (x < 0.80) return "S"; return "SS";
}
function moodForScore(score:number, weak=0.20, strong=0.60, S=100): MoodState["lastMood"]{
  const x = clamp(score/S, -1, 1);
  if (x <= -strong) return "PANIC";
  if (x <= -weak)   return "BEAR";
  if (x >=  strong) return "EUPHORIA";
  if (x >=  weak)   return "BULL";
  return "NEUTRAL";
}
function smooth(prev:number|undefined, next:number, alpha=0.3){
  const p = Number.isFinite(prev ?? NaN) ? (prev as number) : next;
  const a = clamp(alpha, 0, 1);
  return a * next + (1 - a) * p;
}

/* =============================================================================
   V1 — CASCADE ENGINE  (name.vowel.number.greek.posMag)
============================================================================= */

export type MetricKeyV1 = "GFMdelta" | "vSwap" | "Volt" | "Inertia" | "Disruption" | "Amp" | "MEA" | "vTendency";

export interface CascadeCfg extends CommonCfg {
  sequencing: MetricKeyV1[];           // precedence order
  reactiveSensitivity?: number;        // weight nudge strength (default 0.6)
  weak?: number; strong?: number;      // tier thresholds (fractions of S)
}

const BASE_WEIGHTS_V1: Record<Mn, Record<MetricKeyV1, number>> = {
  inj:{ GFMdelta:0.38, vSwap:0.22, Volt:0.18, Disruption:0.12, Inertia:0.05, Amp:0.05, MEA:0, vTendency:0 },
  drn:{ GFMdelta:0.36, Volt:0.22, vSwap:0.16, Disruption:0.12, Inertia:0.08, Amp:0.06, MEA:0, vTendency:0 },
  trl:{ vTendency:0.40, vSwap:0.25, Inertia:0.18, Volt:0.07, Amp:0.05, Disruption:0.05, MEA:0, GFMdelta:0 },
  rev:{ vSwap:0.34, Disruption:0.20, Amp:0.16, vTendency:0.16, Volt:0.08, Inertia:0.06, MEA:0, GFMdelta:0 },
  wnd:{ Inertia:0.36, Volt:0.18, Amp:0.10, vSwap:0.12, vTendency:0.14, Disruption:0.10, MEA:0, GFMdelta:0 },
  emg:{ Disruption:0.30, Volt:0.26, vSwap:0.20, vTendency:0.12, Amp:0.07, Inertia:0.05, MEA:0, GFMdelta:0 },
  stb:{ Inertia:0.44, vTendency:0.18, vSwap:0.16, Volt:0.08, Amp:0.06, Disruption:0.08, MEA:0, GFMdelta:0 },
  flo:{ Amp:0.30, vSwap:0.28, Volt:0.16, vTendency:0.12, Disruption:0.08, Inertia:0.06, MEA:0, GFMdelta:0 },
  std:{ vTendency:0.28, vSwap:0.22, Volt:0.16, Inertia:0.14, Amp:0.10, Disruption:0.10, MEA:0, GFMdelta:0 },
};

function pickNameV1(first: MetricKeyV1, signs:{gfm:number; swap:number; tend:number}): Mn {
  switch (first) {
    case "GFMdelta":   return signs.gfm >= 0 ? "inj" : "drn";
    case "vSwap":      return Math.sign(signs.swap) === Math.sign(signs.tend) ? "trl" : "rev";
    case "Volt":       return signs.tend >= 0 ? "emg" : "wnd";
    case "Inertia":    return "stb";
    case "Disruption": return "emg";
    case "Amp":        return "flo";
    case "vTendency":  return signs.tend >= 0 ? "trl" : "rev";
    default:           return "std";
  }
}
function pickVowel(score:number, S:number){
  const x = score/S;
  if (x >= 0.60) return "a"; if (x >= 0.20) return "e"; if (x > -0.20) return "i"; if (x > -0.60) return "o"; return "u";
}
function pickGreek(inertia:number, disruption:number, amp:number, volt:number){
  if (inertia>=70 && volt<=30 && disruption<=30) return "alpha";
  if (volt>=70 && disruption<60) return "gamma";
  if (disruption>=70) return "delta";
  if (amp>=70) return "epsilon";
  return "beta";
}
function decile01(x:number){ const t = clamp(x,0,1); return Math.max(0,Math.min(9,Math.floor(t*10))); }

function buildReactiveWeightsV1(
  name: Mn,
  sequencing: MetricKeyV1[],
  mags: Partial<Record<MetricKeyV1, number>>,
  sensitivity = 0.6
) {
  // start from base and *materialize* every key exactly once
  const base = BASE_WEIGHTS_V1[name] ?? ({} as Record<MetricKeyV1, number>);
  const allKeys: MetricKeyV1[] = ["GFMdelta","vSwap","Volt","Inertia","Disruption","Amp","MEA","vTendency"];

  const w: Record<MetricKeyV1, number> = {} as any;
  for (const k of allKeys) w[k] = base[k] ?? 0;

  // reactive nudge (boost first, mild damp others)
  const seq = sequencing.filter(k => k in w);
  const first = seq[0], second = seq[1] ?? first;
  const gap = Math.max(0, (mags[first] ?? 0) - (mags[second] ?? 0));
  const boost = 1 + sensitivity * gap;
  const damp  = 1 - 0.5 * sensitivity * gap / Math.max(1, seq.length - 1);

  if (first) w[first] = (w[first] ?? 0) * boost;
  for (const k of allKeys) if (k !== first) w[k] = (w[k] ?? 0) * damp;

  // normalize to sum=1 over non-negative weights
  let Z = 0; for (const k of allKeys) Z += Math.max(0, w[k]);
  if (Z) for (const k of allKeys) w[k] = Math.max(0, w[k]) / Z;

  return w;
}


export interface CascadeOut {
  label: string;                 // name.vowel.number.greek.posMag
  score: number; smoothed: number;
  mood: MoodState["lastMood"]; tier: number; rank: string;
  weights: Record<MetricKeyV1, number>;
  parts: Partial<Record<MetricKeyV1, number>>;
  gfm: { deltaPct:number; persistent:boolean };
}

export function computeMoodCascadeV1(
  inp: CommonInputs,
  prev: MoodState | undefined,
  cfg: CascadeCfg
): CascadeOut {
  const S = cfg.S ?? 100, iota = cfg.iotaPct ?? 0.0058, eps = cfg.epsilonCycles ?? 20;

  // GFMΔ
  const g = gfmDeltaSignal(inp.gfmNow, inp.gfmBaselinePersistent, inp.gfmHistory, iota, eps);
  const s_gfm = g.persistent ? clamp(g.deltaPct, -1, 1) : 0;

  // vectorials
  const s_swap = clamp(inp.vSwapScore/S, -1, 1);
  const s_tend = clamp(inp.vTendencyScore/S, -1, 1);

  // magnitudes as signed by flow
  const m_volt = (inp.volt/100) * (s_tend!==0 ? sgn(s_tend) : 1);
  const m_iner = (inp.inertia/100) * (s_tend!==0 ? sgn(s_tend) : 1);
  const m_disr = (inp.disruption/100) * (s_swap!==0 ? sgn(s_swap) : (s_tend!==0 ? sgn(s_tend) : 1));
  const m_amp  = (inp.amp/100) * (s_swap!==0 ? sgn(s_swap) : (s_tend!==0 ? sgn(s_tend) : 1));
  const s_mea  = conditionMEA(inp.MEA, inp.id_pct, S);

  // magnitudes for gap
  const mags: Partial<Record<MetricKeyV1,number>> = {
    GFMdelta: Math.abs(s_gfm), vSwap: Math.abs(s_swap), vTendency: Math.abs(s_tend),
    Volt: Math.abs(m_volt), Inertia: Math.abs(m_iner), Disruption: Math.abs(m_disr), Amp: Math.abs(m_amp), MEA: Math.abs(s_mea),
  };

  // choose name from first key
  const name = pickNameV1(cfg.sequencing[0], { gfm: s_gfm, swap: s_swap, tend: s_tend });
  const weights = buildReactiveWeightsV1(name, cfg.sequencing, mags, cfg.reactiveSensitivity ?? 0.6);

  // contributions & score
  const parts = {
    GFMdelta: (weights.GFMdelta ?? 0) * s_gfm,
    vSwap:    (weights.vSwap    ?? 0) * s_swap,
    vTendency:(weights.vTendency?? 0) * s_tend,
    Volt:     (weights.Volt     ?? 0) * m_volt,
    Inertia:  (weights.Inertia  ?? 0) * m_iner,
    Disruption:(weights.Disruption??0)* m_disr,
    Amp:      (weights.Amp      ?? 0) * m_amp,
    MEA:      (weights.MEA      ?? 0) * s_mea,
  } as Partial<Record<MetricKeyV1, number>>;
  let unit = 0; (Object.values(parts)).forEach(v => unit += (v ?? 0));
  unit = tanh(1.1 * unit);
  const score = clamp(S * unit, -S, S);
  const smoothed = smooth(prev?.lastScore, score, cfg.smoothAlpha ?? 0.3);

  const vowel = pickVowel(smoothed, S);
  const number = decile01((smoothed + S) / (2*S));
  const greek = pickGreek(inp.inertia, inp.disruption, inp.amp, inp.volt);
  // posMag = first position & its imbalance vs second
  const first = cfg.sequencing[0], second = cfg.sequencing[1] ?? first;
  const gap = Math.max(0, (mags[first] ?? 0) - (mags[second] ?? 0));
  const posMag = `1-${decile01(gap)}`;

  const label = `${name}.${vowel}.${number}.${greek}.${posMag}`;

  return {
    label,
    score, smoothed,
    mood: moodForScore(smoothed, cfg.weak ?? 0.20, cfg.strong ?? 0.60, S),
    tier: tierForScore(smoothed, S),
    rank: rankForScore(smoothed, S),
    weights, parts,
    gfm: { deltaPct: g.deltaPct, persistent: g.persistent },
  };
}

/* =============================================================================
   V2 — SWITCH + OVERALL WEIGHT  (mn.NUM.LETTER-W + final MEA multiplier)
============================================================================= */

export interface SwitchCfg extends CommonCfg {
  sequencing?: ("GFMdelta"|"vSwap"|"vTendency"|"Volt"|"Inertia"|"Disruption"|"Amp")[];
  // Overall weight mapping
  Bpos?: number;  // +% budget when U>0 (default 0.18)
  Bneg?: number;  // +% budget when U<0 (default 0.12)
  Wmin?: number;  // clamp min (default 0.65)
  Wmax?: number;  // clamp max (default 1.45)
}

const PRESET_RETURN_W: Record<Mn, number> = {
  std:1.00, trl:1.05, rev:0.95, inj:1.12, drn:0.88, wnd:0.96, emg:1.04, stb:0.98, flo:1.03,
};

const PRESET_WEIGHTS: Record<Mn, Partial<Record<"GFMdelta"|"vSwap"|"vTendency"|"Volt"|"Inertia"|"Disruption"|"Amp"|"MEA", number>>> = {
  std:{ vTendency:0.28, vSwap:0.22, Volt:0.16, Inertia:0.14, Amp:0.10, Disruption:0.10 },
  trl:{ vTendency:0.40, vSwap:0.25, Inertia:0.18, Volt:0.07, Amp:0.05, Disruption:0.05 },
  rev:{ vSwap:0.34, Disruption:0.20, Amp:0.16, vTendency:0.16, Volt:0.08, Inertia:0.06 },
  inj:{ GFMdelta:0.38, vSwap:0.22, Volt:0.18, Disruption:0.12, Inertia:0.05, Amp:0.05 },
  drn:{ GFMdelta:0.36, Volt:0.22, vSwap:0.16, Disruption:0.12, Inertia:0.08, Amp:0.06 },
  wnd:{ Inertia:0.36, Volt:0.18, Amp:0.10, vSwap:0.12, vTendency:0.14, Disruption:0.10 },
  emg:{ Disruption:0.30, Volt:0.26, vSwap:0.20, vTendency:0.12, Amp:0.07, Inertia:0.05 },
  stb:{ Inertia:0.44, vTendency:0.18, vSwap:0.16, Volt:0.08, Amp:0.06, Disruption:0.08 },
  flo:{ Amp:0.30, vSwap:0.28, Volt:0.16, vTendency:0.12, Disruption:0.08, Inertia:0.06 },
};

function bucketGFM_discrete(deltaPct:number, iota:number): number {
  const s = Math.sign(deltaPct);
  const a = Math.abs(deltaPct) / Math.max(iota, 1e-9);
  const step = a < 0.5 ? 0 : a < 1 ? 1 : a < 2 ? 2 : a < 3 ? 3 : 4;
  return s >= 0 ? 5 + step : 4 - step; // 0..9
}
function metricsLetter_discrete(inertia:number, disruption:number, amp:number, volt:number){
  if (inertia>=70 && volt<=30 && disruption<=30) return "alpha";
  if (disruption>=70) return "delta";
  if (volt>=70 && disruption<60) return "gamma";
  if (amp>=70) return "epsilon";
  return "beta";
}

export interface SwitchOut {
  // label & knobs
  label: string;                     // mn.NUM.LETTER-W
  mn: Mn; num: number; letter: string; weightIndex: number;
  // the single multiplier to apply on MEA:
  finalWeight: number;
  weightedMEA: number | null;        // MEA * finalWeight (null if MEA undefined)
  // internals so you can see the calc:
  unitU: number;                     // combined unit in [-1,1]
  parts: Record<string, number>;     // per-feature contribution
  usedWeights: Record<string, number>;
  gfm: { deltaPct:number; persistent:boolean };
}

export function computeMoodSwitchV2(
  mn: Mn,
  inp: CommonInputs,
  cfg: SwitchCfg = {}
): SwitchOut {
  const S = cfg.S ?? 100, iota = cfg.iotaPct ?? 0.0058, eps = cfg.epsilonCycles ?? 20;
  const sequencing = cfg.sequencing ?? ["GFMdelta","vSwap","vTendency","Volt","Inertia","Disruption","Amp"];

  // (1) first analysis → NUM from vectorial GFM
  const g = gfmDeltaSignal(inp.gfmNow, inp.gfmBaselinePersistent, inp.gfmHistory, iota, eps);
  const num = bucketGFM_discrete(g.deltaPct, iota);

  // (2) metrics → LETTER
  const letter = metricsLetter_discrete(inp.inertia, inp.disruption, inp.amp, inp.volt);

  // (3) unit scores s_i
  const s_gfm  = g.persistent ? clamp(tanh(0.8 * (g.deltaPct / Math.max(iota,1e-9))), -1, 1) : 0;
  const s_swap = clamp(inp.vSwapScore / S, -1, 1);
  const s_tend = clamp(inp.vTendencyScore / S, -1, 1);
  const s_volt = clamp(inp.volt/100, 0, 1) * (s_tend!==0 ? sgn(s_tend) : 1);
  const s_iner = clamp(inp.inertia/100, 0, 1) * (s_tend!==0 ? sgn(s_tend) : 1);
  const s_disr = clamp(inp.disruption/100, 0, 1) * (s_swap!==0 ? sgn(s_swap) : (s_tend!==0 ? sgn(s_tend) : 1));
  const s_amp  = clamp(inp.amp/100, 0, 1) * (s_swap!==0 ? sgn(s_swap) : (s_tend!==0 ? sgn(s_tend) : 1));
  const s_mea  = conditionMEA(inp.MEA, inp.id_pct, S); // small contributor by preset

  // (4) weights (preset + minimal normalization + tiny MEA channel)
  const rawW = { MEA:0, ...PRESET_WEIGHTS[mn] } as Record<string, number>;
  rawW.MEA = (rawW.MEA ?? 0) * 0.25;
  let Z = 0; Object.values(rawW).forEach(v => Z += Math.abs(v));
  const w0 = Object.fromEntries(Object.entries(rawW).map(([k,v])=>[k, Z? v/Z : 0])) as Record<string,number>;

  // reactive nudge from sequencing gap
  const mags: Record<string, number> = {
    GFMdelta: Math.abs(s_gfm), vSwap: Math.abs(s_swap), vTendency: Math.abs(s_tend),
    Volt: Math.abs(s_volt), Inertia: Math.abs(s_iner), Disruption: Math.abs(s_disr), Amp: Math.abs(s_amp), MEA: Math.abs(s_mea),
  };
  const f = sequencing[0], s = sequencing[1] ?? f, gap = Math.max(0, (mags[f] ?? 0) - (mags[s] ?? 0));
  const boost = 1 + 0.6 * gap, damp = 1 - 0.3 * gap / Math.max(1, sequencing.length-1);
  const w: Record<string, number> = { ...w0 };
  if (f in w) w[f] = (w0[f] ?? 0) * boost;
  Object.keys(w).forEach(k => { if (k!==f) w[k] = (w0[k] ?? 0) * damp; });
  let Z2=0; Object.values(w).forEach(v=>Z2+=Math.max(0,v));
  Object.keys(w).forEach(k=> w[k] = Z2? Math.max(0,w[k])/Z2 : 0);

  // (5) aggregate to U
  const parts = {
    GFMdelta:(w.GFMdelta ?? 0) * s_gfm,
    vSwap:   (w.vSwap    ?? 0) * s_swap,
    vTendency:(w.vTendency?? 0) * s_tend,
    Volt:    (w.Volt     ?? 0) * s_volt,
    Inertia: (w.Inertia  ?? 0) * s_iner,
    Disruption:(w.Disruption??0) * s_disr,
    Amp:     (w.Amp      ?? 0) * s_amp,
    MEA:     (w.MEA      ?? 0) * s_mea,
  };
  let U = 0; Object.values(parts).forEach(v => U += v);
  U = clamp(U, -1, 1);

  // (6) U → single multiplier W (log-additive budgets)
  const Bpos = cfg.Bpos ?? 0.18, Bneg = cfg.Bneg ?? 0.12; // +18% / -12% budgets
  const Wmin = cfg.Wmin ?? 0.65, Wmax = cfg.Wmax ?? 1.45;
  const λp = Math.log(1 + Math.max(0, Bpos));
  const λn = Math.log(1 + Math.max(0, Bneg));
  const mult = Math.exp(λp * Math.max(0, U) - λn * Math.max(0, -U));

  const baseW = PRESET_RETURN_W[mn] ?? 1.0;
  const finalWeight = clamp(baseW * mult, Wmin, Wmax);
  const weightedMEA = Number.isFinite(inp.MEA as number) ? (inp.MEA as number) * finalWeight : null;

  // (7) label mn.NUM.LETTER-W
  const weightIndex = Math.floor(clamp( (Math.abs(baseW-1)/0.15 + gap)/2, 0, 1) * 10); // 0..9
  const label = `${mn}.${num}.${letter}-${weightIndex}`;

  return { label, mn, num, letter, weightIndex, finalWeight, weightedMEA, unitU: U, parts, usedWeights: w, gfm: { deltaPct:g.deltaPct, persistent:g.persistent } };
}
