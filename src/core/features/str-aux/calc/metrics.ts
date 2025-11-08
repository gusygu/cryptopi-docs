// src/core/maths/metrics.ts
// Metrics aligned to your definitions (IDHR/ecosystem-aware).
// Scales: strengths → [0..100], directional → [-100..100].

/* ───────────────────────────── basics ───────────────────────────── */

export type Scale = number; // envelope; default S = 100

const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));
const tanh = (x: number) => { const e = Math.exp(2 * x); return (e - 1) / (e + 1); };
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
const mean = (xs: number[]) => (xs.length ? sum(xs) / xs.length : 0);
const sign = (x: number) => (x > 0 ? 1 : x < 0 ? -1 : 0);

function median(xs: number[]) {
  if (!xs.length) return 0;
  const s = xs.slice().sort((a, b) => a - b); const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
function mad(xs: number[]) {
  if (!xs.length) return 0;
  const m = median(xs); const dev = xs.map(x => Math.abs(x - m));
  return median(dev);
}
function iqr(xs: number[]) {
  if (!xs.length) return 0;
  const s = xs.slice().sort((a, b) => a - b);
  const q = (p: number) => {
    const idx = (s.length - 1) * p, lo = Math.floor(idx), hi = Math.ceil(idx);
    return lo === hi ? s[lo] : s[lo] + (s[hi] - s[lo]) * (idx - lo);
  };
  return q(0.75) - q(0.25);
}
function fracFlips(xs: number[]) {
  let flips = 0, valid = 0, prev: number | null = null;
  for (const v of xs) {
    const s = sign(v); if (s === 0) continue;
    if (prev === null) { prev = s; continue; }
    valid++; if (s !== prev) { flips++; prev = s; }
  }
  return valid ? flips / valid : 0;
}
function hhi(shares: number[]) {
  const s = shares.map(x => Math.max(0, x)); const Z = sum(s);
  if (!Z) return 0;
  return s.reduce((a, x) => a + Math.pow(x / Z, 2), 0); // [1/K..1]
}

/* ───────────────────────────── inputs ─────────────────────────────
   r_t  : coin growth/return series (unitless, can be in ±S)
   M_t  : ecosystem baseline series (same length as r_t)
   Δ_t  : divergence series (r_t - M_t) if you prefer to pass directly
   W    : window (ticks/steps)
   S    : envelope scale (default 100)
   ε    : epsilon guard for divisions
────────────────────────────────────────────────────────────────── */

/* ───────────────────────────── Inertia ─────────────────────────────
   Your meaning:
   - Static inertia: stays put (no growth), low step noise.
   - Growth inertia: keeps the same growth pattern; large steady median vs noise.
   Returns components in [0..100] and a unified "face".
────────────────────────────────────────────────────────────────── */

export function inertiaFromReturns(
  r: number[],
  opts: { window?: number; beta_s?: number; beta_m?: number; beta_g?: number; tau0?: number } = {}
): { static: number; growth: number; total: number; face: "static" | "growth" } {
  const W = Math.max(5, Math.floor(opts.window ?? Math.min(30, r.length)));
  if (r.length < 3) return { static: 0, growth: 0, total: 0, face: "static" };
  const y = r.slice(-W);
  const diffs = []; for (let i = 1; i < y.length; i++) diffs.push(y[i] - y[i - 1]);
  const mu = median(y), spreadD = mad(diffs);
  const beta_s = opts.beta_s ?? 1.0;
  const beta_m = opts.beta_m ?? 1.0;
  const beta_g = opts.beta_g ?? 1.0;
  const tau0 = opts.tau0 ?? 0.01; // "near zero" target for static

  // static: small steps + median ~ 0
  const staticU = tanh(beta_s * (1 / (1 + spreadD))) * tanh(beta_m * (tau0 / (Math.abs(mu) + 1e-9)));
  // growth: large |median| vs small step noise
  const growthU = tanh(beta_g * (Math.abs(mu) / (spreadD + 1e-9)));

  const s = 100 * clamp(staticU, 0, 1);
  const g = 100 * clamp(growthU, 0, 1);
  const face = g > s ? "growth" : "static";
  return { static: s, growth: g, total: Math.max(s, g), face };
}

/* ───────────────────────────── Disruption ─────────────────────────────
   Your meaning: instant move out of inertia; systemic = proportion of coins.
────────────────────────────────────────────────────────────────── */

export function disruptionInstant(
  rNow: number,
  refWindow: number[] // recent returns (window W) for the SAME coin
, gamma = 1.0): number {
  const mu = median(refWindow);
  const spreadD = mad(refWindow.length > 1 ? refWindow.map((v, i, a) => (i ? v - a[i - 1] : 0)).slice(1) : [0]);
  const u = tanh(gamma * (Math.abs(rNow - mu) / (spreadD + 1e-9)));
  return 100 * clamp(u, 0, 1);
}

/** systemic disruption = share of coins whose instant disruption >= threshold */
export function disruptionSystemic(disruptions: number[], threshold = 60): number {
  if (!disruptions.length) return 0;
  const k = disruptions.filter(d => d >= threshold).length;
  return (k / disruptions.length) * 100; // percent of universe
}

/* ───────────────────────────── Amp (amperage) ─────────────────────────────
   Your meaning: tendency to flip between growth/shrink; swap frequency matters.
   Amp = swing size × flip rate → [0..100].
────────────────────────────────────────────────────────────────── */

export function ampFromSeries(
  r: number[],
  opts: { window?: number; etaA?: number; etaF?: number; S?: Scale } = {}
): number {
  const W = Math.max(5, Math.floor(opts.window ?? Math.min(30, r.length)));
  if (r.length < 3) return 0;
  const y = r.slice(-W);
  const S = opts.S ?? 100;
  const swing = mad(y);                    // typical swing size (unitless)
  const flips = fracFlips(y);              // 0..1
  const u = tanh((opts.etaA ?? 1.0) * (swing / (S || 100))) * tanh((opts.etaF ?? 1.0) * flips);
  return 100 * clamp(u, 0, 1);
}

/* ───────────────────────────── Volt (voltage) ─────────────────────────────
   Your meaning: persistent imbalance (insulation) vs ecosystem.
   Use divergence Δ_t = r_t - M_t. Volt ∈ [0..100].
────────────────────────────────────────────────────────────────── */

export function voltFromDivergence(
  delta: number[],
  opts?: { window?: number; lambda?: number; spread?: number }
): number {
  const W = Math.max(5, Math.floor(opts?.window ?? Math.min(30, delta.length)));
  if (delta.length < 3) return 0;
  const d = delta.slice(-W);

  // FIXED: avoid mixing ?? and ||, also guard against 0
  const spread = Math.max(1e-9, opts?.spread ?? mad(d));

  const avgAbsZ = mean(d.map(x => Math.abs(x) / spread));
  const u = tanh((opts?.lambda ?? 1.0) * avgAbsZ);
  return 100 * clamp(u, 0, 1);
}

/** helper if you have r_t and M_t instead of Δ_t */
export function voltFromReturns(r: number[], M: number[], opts?: { window?: number; lambda?: number }) {
  const n = Math.min(r.length, M.length);
  const delta = []; for (let i = 0; i < n; i++) delta.push(r[i] - M[i]);
  return voltFromDivergence(delta, { window: opts?.window, lambda: opts?.lambda });
}

export function voltFromSeries(y:number[], opts?: { window?: number; lambda?: number; S?: Scale }): number {
  const W = Math.max(5, Math.floor(opts?.window ?? Math.min(30, y.length)));
  if (y.length < 3) return 0;
  const slice = y.slice(-W);
  const diffs = []; for (let i=1;i<slice.length;i++) diffs.push(slice[i]-slice[i-1]);
  const S = opts?.S ?? 100;
  const lambda = opts?.lambda ?? 1.0;
  return 100 * tanh(lambda * (mad(diffs) / S));
}

/* ───────────────────────── Inflation / Deflation (systemic) ─────────────────────────
   Your meaning: position vs the system (ecosystemic analysis).
   Level variant: L_t vs system level M_t^ℓ → signed in [-100..100].
────────────────────────────────────────────────────────────────── */

export function inflDefLevel(
  L_now: number,        // coin level (index) now
  M_now: number,        // system level now
  opts: { kappa?: number; S?: Scale } = {}
): number {
  const S = opts.S ?? 100; const kappa = opts.kappa ?? 1.0;
  const ratio = M_now > 0 ? L_now / M_now : 1;
  const R = Math.log(Math.max(1e-9, ratio));   // + inflation (richer), - deflation
  return clamp(S * tanh(kappa * R), -S, S);
}

/** rate variant (change vs previous step) if you want an “infl/def rate” later */
export function inflDefRate(R_now: number, R_prev: number, opts: { kappa?: number; S?: Scale } = {}) {
  const S = opts.S ?? 100; const kappa = opts.kappa ?? 1.0;
  const dR = R_now - R_prev; // already unitless
  return clamp(S * tanh(kappa * dR), -S, S);
}

/* ───────────────────────── Artificiality & Efficiency ─────────────────────────
   Your meaning:
   - Artificiality = mismatch between “bulk orders” and resulting benchmark move,
     plus execution churn / bin concentration (speculative/contrived).
   - Efficiency  = consolidated organic growth (trend × strength) penalized by
     volatility and artificiality → [-100..100].
────────────────────────────────────────────────────────────────── */

export interface ArtificialityInputs {
  // Expected vs observed impact (same units, e.g., return or Δbenchmark over tick)
  expectedImpact: number;   // from orderbook microstructure model
  observedChange: number;   // actual benchmark change
  // Execution stats over window H:
  placed?: number; canceled?: number; executed?: number; // counts or notional
  // Concentration: per-bin contributions (abs inner * share) for current tick or mean over window
  contribShares?: number[]; // does not need to sum to 1; we normalize
}

export function artificialityScore(
  inp: ArtificialityInputs,
  weights: { wMismatch?: number; wExec?: number; wHHI?: number } = {}
): number {
  const wM = weights.wMismatch ?? 0.5;
  const wE = weights.wExec ?? 0.3;
  const wH = weights.wHHI ?? 0.2;

  // (1) Impact mismatch (0..1): large if book suggests big move but price barely moves (or vice-versa)
  const mismatch = Math.abs(inp.expectedImpact) / (Math.abs(inp.observedChange) + 1e-9);
  const M = clamp(tanh(0.75 * Math.log(1 + mismatch)), 0, 1); // soft-bounded 0..1

  // (2) Execution ratio (0..1): churny if (placed+cancel)/executed is large
  let E = 0;
  if ((inp.executed ?? 0) > 0) {
    const ratio = ((inp.placed ?? 0) + (inp.canceled ?? 0)) / (inp.executed ?? 1);
    E = clamp(tanh(0.5 * Math.log(1 + ratio)), 0, 1);
  }

  // (3) Concentration via normalized HHI (0..1)
  let H = 0;
  if (inp.contribShares && inp.contribShares.length) {
    const raw = hhi(inp.contribShares);
    // normalize: minimal ~0 (broad) → 0, maximal 1 → 1 (we skip 1/K floor; unknown K)
    H = clamp((raw - 0) / (1 - 0), 0, 1);
  }

  const A = clamp(wM * M + wE * E + wH * H, 0, 1);
  return 100 * A; // 0..100 (higher = more artificial)
}

export interface EfficiencyInputs {
  tendencyDirection: number; // from vTendency.direction in [-1,1]
  tendencyStrength: number;  // from vTendency.strength in [0,1]
  volt01?: number;           // volt in [0..1] (use voltFrom…/100)
  artificiality01?: number;  // artificiality in [0..1] (artificialityScore/100)
}

export function efficiencyScore(
  inp: EfficiencyInputs,
  weights: { wTrend?: number; wVolt?: number; wArt?: number; alpha?: number; S?: Scale } = {}
): number {
  const wT = weights.wTrend ?? 0.6;
  const wV = weights.wVolt ?? 0.2;
  const wA = weights.wArt ?? 0.2;
  const alpha = weights.alpha ?? 1.2;
  const S = weights.S ?? 100;

  // “Organic growth”: direction × strength ([-1,1])
  const trend = clamp(inp.tendencyDirection, -1, 1) * clamp(inp.tendencyStrength, 0, 1);
  const volt = clamp(inp.volt01 ?? 0, 0, 1);             // penalty
  const art  = clamp(inp.artificiality01 ?? 0, 0, 1);    // penalty

  const raw = wT * trend - wV * volt - wA * art;
  return clamp(S * tanh(alpha * raw), -S, S);            // [-S,S]
}
