// mood.ts — formula, buckets, UUID

export type MoodInputs = {
  vTendency: number | null; // signed, foundational, clamp abs to 1.2
  GFM: number | null;       // factor, clamp to [0.8..1.2]
  vSwap: number | null;     // signed, clamp abs to 0.5
};

export type MoodBuckets = { vTendencyIdx: number; vSwapIdx: number; GFMIdx: number };
export type MoodUUID = string;

const clamp = (x: number, lo: number, hi: number) => Math.min(Math.max(x, lo), hi);

// --- Ranges
const V_TEND_ABS_MAX = 1.2;
const V_SWAP_ABS_MAX = 0.5;
const GFM_MIN = 0.8, GFM_MAX = 1.2;

// --- Helpers
function eqCuts(maxAbs: number, bins: number): number[] {
  const step = maxAbs / bins;
  return Array.from({ length: bins - 1 }, (_, i) => step * (i + 1)); // absolute cuts
}
function binSigned(x: number, absCuts: number[], upBins: number, downBins: number): number {
  const a = Math.abs(x);
  let idx = 0;
  while (idx < absCuts.length && a > absCuts[idx]) idx++;
  return x >= 0 ? Math.min(idx, upBins - 1) : upBins + Math.min(idx, downBins - 1);
}
function binAroundOne(gfm: number): number {
  // map to 8 bins: 0..3 for >=1.0, 4..7 for <1.0
  const delta = Math.abs((gfm ?? 1) - 1);
  // cuts every 0.05 up to 0.20
  const cuts = [0.05, 0.10, 0.15];
  let idx = 0;
  while (idx < cuts.length && delta > cuts[idx]) idx++;
  if (idx > 3) idx = 3;
  return (gfm ?? 1) >= 1 ? idx : 4 + idx;
}

// --- UUID alphabets
const VT_UP = ["A","B","C","D","E","F"];
const VT_DN = ["G","H","I","J","K","L"];
const VS_UP = ["a","b","c","d","e","f"];
const VS_DN = ["g","h","i","j","k","l"];

// --- Public API

export function computeMoodCoeffV1(inp: MoodInputs) {
  const vT = Math.sign(inp.vTendency ?? 0) * clamp(Math.abs(inp.vTendency ?? 0), 0, V_TEND_ABS_MAX);
  const vS = Math.sign(inp.vSwap ?? 0)     * clamp(Math.abs(inp.vSwap ?? 0),     0, V_SWAP_ABS_MAX);
  const gf  = clamp(inp.GFM ?? 1, GFM_MIN, GFM_MAX);

  // Your formula
  let coeff = ( (vT || 0) / (gf || 1) ) + (vS || 0);
  coeff = clamp(coeff, 0.2, 2.0);

  // Buckets
  const vtCuts = eqCuts(V_TEND_ABS_MAX, 6);
  const vsCuts = eqCuts(V_SWAP_ABS_MAX, 6);
  const vTIdx  = binSigned(vT, vtCuts, 6, 6);
  const vSIdx  = binSigned(vS, vsCuts, 6, 6);
  const gIdx   = binAroundOne(gf);

  return { coeff, buckets: { vTendencyIdx: vTIdx, vSwapIdx: vSIdx, GFMIdx: gIdx } as MoodBuckets };
}

export function moodUUIDFromBuckets(b: MoodBuckets): MoodUUID {
  const vt = b.vTendencyIdx < 6 ? VT_UP[b.vTendencyIdx] : VT_DN[b.vTendencyIdx - 6];
  const vs = b.vSwapIdx     < 6 ? VS_UP[b.vSwapIdx]     : VS_DN[b.vSwapIdx - 6];
  const g  = String(b.GFMIdx); // 0..7
  return `${vt}${vs}${g}`;
}

// Add near top:
export type MoodReferentials = {
  gfmScale?: number; // default 20
  vtMu: number; vtSigma: number; // FRV and dispersion for trend
  vsMu: number; vsSigma: number; // FRV and dispersion for swap
  vsAlpha?: number; // default 0.75
};

// Convert raw → normalized MoodInputs
export function normalizeMoodInputs(raw: {
  gfmDeltaPct: number;   // e.g., +0.01 for +1%
  tendencyRaw: number;   // your trend proxy
  swapRaw: number;       // your swap velocity proxy
}, ref: MoodReferentials): MoodInputs {
  const eps = 1e-9;
  const Kg = ref.gfmScale ?? 20;
  const GFM = Math.min(Math.max(1 + Kg * raw.gfmDeltaPct, 0.8), 1.2);

  const zT = Math.max(-1, Math.min(1, (raw.tendencyRaw - ref.vtMu) / ((ref.vtSigma || eps))));
  const vTendency = 0.8 + 0.4 * zT;

  const zS = (raw.swapRaw - ref.vsMu) / ((ref.vsSigma || eps));
  const vSwap = 0.5 * Math.tanh((ref.vsAlpha ?? 0.75) * zS);

  return { vTendency, GFM, vSwap };
}
