// src/strategy_aux/tendency.ts
// Core utilities for vInner / vOuter and the decision engine (growth/collapse/shift/maintenance)
//
// No external deps. Robust scaling via MAD. Designed to be pure & unit-testable.

export type TendencyState =
  | "growth"
  | "collapse"
  | "shift"
  | "maintenance"
  | "indeterminate";

export type NucleusSample = {
  /** price (or 1D coordinate along which we measure distance to center) */
  p: number;
  /** weight for this sample: volume/liquidity/score (>=0) */
  w: number;
};

export type Nucleus = {
  /** samples inside the nucleus/bucket */
  samples: NucleusSample[];
  /** optional precomputed center of this nucleus; if omitted, weighted mean is used */
  center?: number;
};

export type ComposeWeights = {
  /** optional per-nucleus weight (e.g., liquidity share); default = 1 */
  gamma?: number;
};

export type DecideOpts = {
  /** normalization deadzone threshold (|v̂| below this is treated as ~0) */
  deadzone?: number; // τ0
  /** confidence to enter a state */
  enter?: number;
  /** confidence to keep a state (hysteresis) */
  stay?: number;
  /** last chosen state (enables hysteresis) */
  lastState?: TendencyState;
};

export type DecideOutput = {
  state: TendencyState;
  confidence: number;
  vIhat: number;
  vOhat: number;
};

/** small epsilon to avoid division-by-zero */
const EPS = 1e-9;

/** Weighted mean (center). */
export function weightedMean(xs: NucleusSample[], fallback = 0): number {
  let sw = 0, sp = 0;
  for (const { p, w } of xs) {
    if (w > 0) { sw += w; sp += w * p; }
  }
  return sw > 0 ? sp / sw : fallback;
}

/** Robust scale via MAD (median absolute deviation) × 1.4826 (≈ std if normal). */
export function madScale(xs: number[]): number {
  if (xs.length === 0) return 0;
  const arr = xs.slice().sort((a, b) => a - b);
  const med = arr[Math.floor(arr.length / 2)];
  const devs = arr.map(v => Math.abs(v - med)).sort((a, b) => a - b);
  const mad = devs[Math.floor(devs.length / 2)];
  return 1.4826 * mad;
}

/** tanh-robustify a residual using provided scale (σ). */
function robustTanh(residual: number, sigma: number): number {
  const s = Math.max(Math.abs(sigma), EPS);
  return Math.tanh(residual / s);
}

/**
 * Compute vInner for a nucleus:
 *  vInner = (1/W) * Σ w_i * tanh((p_i - c)/σ)
 * If center not provided, uses weighted mean. σ is robust scale (MAD) of residuals.
 */
export function computeInner(nucleus: Nucleus): number {
  const samples = nucleus.samples;
  if (!samples || samples.length === 0) return 0;

  const c = nucleus.center ?? weightedMean(samples, 0);

  // residuals for scale
  const residuals: number[] = [];
  let W = 0;
  for (const { p, w } of samples) {
    if (w > 0) {
      residuals.push(p - c);
      W += w;
    }
  }
  if (W <= 0) return 0;

  const sigma = madScale(residuals) || 0;
  let acc = 0;
  for (const { p, w } of samples) {
    if (w > 0) acc += w * robustTanh(p - c, sigma);
  }
  return acc / (W + EPS);
}

/**
 * Compose vOuter from a collection of vInner values and optional per-nucleus weights γ_k.
 * Defaults to unweighted sum. For liquidity-weighted sum, pass gamma as share (∈[0,1]).
 */
export function composeOuter(vInners: number[], weights?: ComposeWeights[]): number {
  if (vInners.length === 0) return 0;
  if (!weights || weights.length !== vInners.length) {
    // simple sum
    return vInners.reduce((a, b) => a + b, 0);
  }
  let acc = 0;
  for (let i = 0; i < vInners.length; i++) {
    const g = weights[i]?.gamma ?? 1;
    acc += g * vInners[i];
  }
  return acc;
}

/** Robust scale proxy for a series of values (e.g., for vInner normalization). */
export function robustScaleOf(values: number[]): number {
  if (values.length === 0) return 0;
  return madScale(values);
}

/**
 * Decision engine based on signs of (vI, vO) with normalization + deadzone + hysteresis.
 * - Normalize by sigmaI, sigmaO (robust).
 * - Apply deadzone around 0.
 * - Confidence blends magnitude & balance of v̂I and v̂O.
 */
export function decideTendency(
  vI: number,
  vO: number,
  sigmaI: number,
  sigmaO: number,
  opts?: DecideOpts
): DecideOutput {
  const dead = opts?.deadzone ?? 0.4;
  const enter = opts?.enter ?? 0.5;
  const stay  = opts?.stay  ?? 0.35;

  const vIhat = vI / (Math.abs(sigmaI) + EPS);
  const vOhat = vO / (Math.abs(sigmaO) + EPS);

  const gate = (x: number) => (Math.abs(x) < dead ? 0 : x);
  const gi = gate(vIhat), go = gate(vOhat);

  const sgn = (x: number) => (x > 0 ? 1 : x < 0 ? -1 : 0);
  const magI = Math.abs(gi), magO = Math.abs(go);
  const mag  = Math.min(magI, magO);                 // weakest link
  const bal  = mag / (Math.max(magI, magO) + EPS);   // 0..1 balance
  const conf = mag * (0.5 + 0.5 * bal);              // magnitude × balance

  const threshold = (opts?.lastState && opts.lastState !== "indeterminate") ? stay : enter;

  let state: TendencyState = "indeterminate";
  if (conf >= threshold) {
    if (gi > 0 && go > 0) state = "growth";
    else if (gi < 0 && go < 0) state = "collapse";
    else if (gi > 0 && go < 0) state = "shift";
    else if (gi < 0 && go > 0) state = "maintenance";
  } else {
    // Optional soft default when outer is near zero but inner shrinks
    if (Math.abs(go) < dead && gi < 0) state = "maintenance";
  }

  return { state, confidence: Math.min(conf, 3), vIhat, vOhat };
}

/** Convenience: compute vInner for each nucleus and compose vOuter in one go. */
export function computeInnerAndOuter(
  nuclei: Nucleus[],
  compose?: ComposeWeights[]
): { vInners: number[]; vOuter: number } {
  const vInners = nuclei.map(computeInner);
  const vOuter  = composeOuter(vInners, compose);
  return { vInners, vOuter };
}

/* -------------------------------------------------------------------------- */
/*                       Scaled vector metrics for IDHR                       */
/* -------------------------------------------------------------------------- */

const __clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));

/** vInner in ±scale (default ±100). Uses computeInner() then squashes & scales. */
export function vInnerScaled(nucleus: Nucleus, scale = 100, gain = 1): number {
  const raw = computeInner(nucleus); // [-1..1]
  // slight extra tanh to keep tails gentle when scale is large
  return __clamp(scale * Math.tanh(gain * raw), -scale, scale);
}

export interface OuterOpts {
  scale?: number;                 // ±100 default
  normalizeOuter?: boolean;       // true: divide by sumGamma or N; false: trust γ as shares
  gain?: number;                  // nonlinearity gain before tanh
}

/**
 * Outer across nuclei with a scaled score in ±scale.
 * - If weights are shares (∑γ = 1), set normalizeOuter=false (default true).
 */
export function vOuterScaled(
  nuclei: Nucleus[],
  weights?: ComposeWeights[],
  opts: OuterOpts = {}
): { vInners: number[]; outer: number; score: number } {
  const scale = opts.scale ?? 100;
  const gain  = opts.gain  ?? 1;
  const { vInners, vOuter } = computeInnerAndOuter(nuclei, weights);

  let unitOuter = vOuter;
  if (opts.normalizeOuter !== false) {
    const sumGamma = weights?.reduce((a, w) => a + (w?.gamma ?? 1), 0) ?? nuclei.length;
    unitOuter = sumGamma ? vOuter / sumGamma : 0; // back to ~[-1..1]
  }
  const score = __clamp(scale * Math.tanh(gain * unitOuter), -scale, scale);
  return { vInners, outer: vOuter, score };
}

/* ------------------------------ vTendency --------------------------------- */

type Normalizer = "stdev" | "mad";
function __mean(xs: number[]) { return xs.length ? xs.reduce((a,b)=>a+b,0)/xs.length : 0; }
function __stdev(xs: number[]) {
  if (xs.length < 2) return 0;
  const m = __mean(xs); let a = 0;
  for (let i = 0; i < xs.length; i++) { const d = xs[i]-m; a += d*d; }
  return Math.sqrt(a/(xs.length-1));
}
function __linreg(y: number[]) {
  const n = y.length; if (n < 2) return { slope: 0, r: 0 };
  let sx=0, sy=0, sxx=0, sxy=0, syy=0;
  for (let i=0;i<n;i++){ const xi=i, yi=y[i]; sx+=xi; sy+=yi; sxx+=xi*xi; sxy+=xi*yi; syy+=yi*yi; }
  const num = n*sxy - sx*sy, den = n*sxx - sx*sx;
  const slope = den === 0 ? 0 : num/den;
  const rden = Math.sqrt((n*sxx - sx*sx) * (n*syy - sy*sy));
  const r = rden === 0 ? 0 : num / rden;
  return { slope, r };
}

/**
 * vTendencyFromSeries: trend score from a time series (e.g., vOuter over time).
 * - Normalize slope by dispersion of first differences (MAD or stdev).
 * - Score in ±scale (default ±100). Also returns raw slope & r.
 */
export function vTendencyFromSeries(
  series: number[],
  opts: { window?: number; scale?: number; k?: number; normalizer?: Normalizer } = {}
): { direction: number; strength: number; slope: number; r: number; score: number } {
  const window = Math.max(3, Math.floor(opts.window ?? 20));
  const scale  = opts.scale ?? 100;
  const k      = opts.k ?? 1.0;
  const norm   = opts.normalizer ?? "mad";
  if (!series?.length || series.length < 2) {
    return { direction: 0, strength: 0, slope: 0, r: 0, score: 0 };
  }
  const start = Math.max(0, series.length - window);
  const slice = series.slice(start);
  const { slope, r } = __linreg(slice);

  // dispersion of *differences* is robust for slope normalization
  const diffs: number[] = [];
  for (let i = 1; i < slice.length; i++) diffs.push(slice[i] - slice[i-1]);
  const disp = norm === "mad" ? madScale(diffs) : __stdev(diffs);
  const z = disp > 0 ? slope / disp : 0;

  const direction = Math.tanh(k * z);       // [-1..1]
  const strength  = Math.min(1, Math.max(0, Math.abs(r)));
  const score     = __clamp(direction * scale, -scale, scale);
  return { direction, strength, slope, r, score };
}

/* -------------------------------- vSwap ----------------------------------- */
/**
 * vSwap: “market swap” = relation between **sum/avg of inner vectors** and **tendency**.
 * - Take liquidity-weighted avg inner (or uniform avg if no weights).
 * - Project onto the sign of tendency; squash and scale to ±scale.
 */
export function vSwapFromNuclei(
  nuclei: Nucleus[],
  tendencyScore: number,               // from vTendencyFromSeries(...).score
  weights?: ComposeWeights[],
  scale = 100
): number {
  if (!nuclei?.length) return 0;
  const { vInners } = computeInnerAndOuter(nuclei, weights);
  const gammas = weights?.map(w => w?.gamma ?? 1) ?? Array(vInners.length).fill(1);
  const sumG = gammas.reduce((a,b)=>a+b,0) || 1;
  let avgInner = 0;
  for (let i=0;i<vInners.length;i++) avgInner += (gammas[i] * vInners[i]);
  avgInner /= sumG; // ~[-1..1] if inners bounded

  const sgn = Math.sign(tendencyScore || 0);
  const coherence = avgInner * sgn;                 // confirms (+) or opposes (−) the drift
  return __clamp(scale * Math.tanh(coherence / 0.25), -scale, scale);
}
