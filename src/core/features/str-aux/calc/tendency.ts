// tendency.ts
// IDHR/binning tendency vectors: vInner, vOuter, vTendency, vSwap (quartiles).
// Scale convention: default S = 100; all public scores in [-S, +S]. No external deps.

/* ----------------------------- Types & Helpers ---------------------------- */

export type Scale = number; // accept any numeric scale; default 100

export interface Nucleus {
  // Bin samples (e.g., normalized price offsets).
  values: number[];
  // Optional per-sample weights (liquidity/volume/time). Must match values.length if provided.
  weights?: number[];
  // Optional precomputed center of the bin (else computed as weighted median).
  center?: number;
}

export interface ComposeWeights {
  // Bin-level weight (e.g., liquidity share). If not provided, treated as 1.
  gamma?: number;
}

const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));

const tanh = (x: number) => {
  const e = Math.exp(2 * x);
  return (e - 1) / (e + 1);
};

const sum  = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
const mean = (xs: number[]) => (xs.length ? sum(xs) / xs.length : 0);

function sortBy<T>(arr: T[], key: (t: T) => number): T[] {
  return arr.slice().sort((a, b) => key(a) - key(b));
}

/** Weighted median of x with weights w (positive). Falls back to plain median if no weights. */
function wMedian(x: number[], w?: number[]): number {
  const n = x.length;
  if (!n) return 0;
  if (!w || w.length !== n) {
    const xs = x.slice().sort((a, b) => a - b);
    const m = Math.floor(n / 2);
    return n % 2 ? xs[m] : (xs[m - 1] + xs[m]) / 2;
  }
  const pairs = sortBy(
    x.map((xi, i) => ({ xi, wi: Math.max(0, Number.isFinite(w[i]!) ? w[i]! : 0) })),
    (p) => p.xi
  );
  const total = pairs.reduce((a, p) => a + p.wi, 0);
  if (total <= 0) return wMedian(x); // fallback to unweighted
  let c = 0;
  for (let i = 0; i < pairs.length; i++) {
    c += pairs[i].wi;
    if (c >= total / 2) return pairs[i].xi;
  }
  return pairs[pairs.length - 1].xi;
}

/** Weighted MAD: median of |x - center|, with same weights. */
function wMAD(x: number[], w?: number[], center?: number): number {
  if (!x.length) return 0;
  const c = center ?? wMedian(x, w);
  const dev = x.map((xi) => Math.abs(xi - c));
  return wMedian(dev, w);
}

function quantile(sorted: number[], p: number): number {
  if (!sorted.length) return 0;
  const idx = (sorted.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  const a = sorted[lo], b = sorted[hi];
  return a + (b - a) * (idx - lo);
}

/* -------------------------------- vInner ---------------------------------- */

export interface VInnerOpts {
  // Gain before tanh (sensitivity).
  gain?: number; // default 1.0
  // Output scale envelope.
  scale?: number; // default 100
  // If provided, use this dispersion instead of MAD.
  sigmaOverride?: number;
  // If provided, use this center instead of weighted median.
  centerOverride?: number;
}

/**
 * vInner_k: per-bin skew of distribution.
 * 1) Normalize residuals by robust dispersion (MAD).
 * 2) Weighted mean residual -> tanh -> scaled to [-S, S].
 */
export function vInner(nucleus: Nucleus, opts: VInnerOpts = {}): number {
  const S: number = opts.scale ?? 100;
  const g: number = opts.gain ?? 1.0;
  const x = nucleus.values ?? [];
  const w = nucleus.weights && nucleus.weights.length === x.length ? nucleus.weights : undefined;
  if (!x.length) return 0;

  const c = opts.centerOverride ?? nucleus.center ?? wMedian(x, w);
  const sigma = opts.sigmaOverride ?? wMAD(x, w, c);
  const denom = sigma > 0 ? sigma : 1e-9;

  // weighted mean of standardized residuals
  let num = 0, den = 0;
  for (let i = 0; i < x.length; i++) {
    const wi = w ? Math.max(0, w[i] || 0) : 1;
    num += wi * ((x[i] - c) / denom);
    den += wi;
  }
  const rbar = den > 0 ? num / den : 0;
  return clamp(S * tanh(g * rbar), -S, S);
}

/* -------------------------------- vOuter ---------------------------------- */

export interface VOuterOpts {
  // Scale envelope for output (±).
  scale?: number; // default 100
  // Nonlinearity gain before tanh.
  gain?: number; // default 1.0
  // If true (default), normalize outer by sum of gammas or N if none provided.
  normalize?: boolean; // default true
  // Reuse vInner options for each bin (e.g., same gain/scale).
  inner?: VInnerOpts;
}

/**
 * vOuter: liquidity-weighted aggregation across bins.
 * If weights sum to 1 (shares), set normalize=false to respect them.
 */
export function vOuter(nuclei: Nucleus[], weights?: ComposeWeights[], opts: VOuterOpts = {}): number {
  const S: number = opts.scale ?? 100;
  const g: number = opts.gain ?? 1.0;
  const inners = nuclei.map((nu) => vInner(nu, { ...opts.inner, scale: S }));
  const gammas = weights?.map((w) => (Number.isFinite(w?.gamma as number) ? (w!.gamma as number) : 1))
    ?? Array(nuclei.length).fill(1);
  if (!inners.length) return 0;

  const sumG = sum(gammas);
  const denom = opts.normalize === false ? 1 : (sumG || inners.length);
  let agg = 0;
  for (let i = 0; i < inners.length; i++) agg += gammas[i] * (inners[i] / S);
  const unitless = denom ? agg / denom : 0; // ~[-1..1]
  return clamp(S * tanh(g * unitless), -S, S);
}

/* ---- optional “scaled” convenience (maps sign-preserving to ~[-1..1]) ---- */

export function vInnerScaled(nucleus: Nucleus, opts: VInnerOpts = {}): number {
  const S = opts.scale ?? 100;
  const v = vInner(nucleus, opts);
  return clamp(v / S, -1, 1);
}
export function vOuterScaled(nuclei: Nucleus[], weights?: ComposeWeights[], opts: VOuterOpts = {}): number {
  const S = opts.scale ?? 100;
  const v = vOuter(nuclei, weights, opts);
  return clamp(v / S, -1, 1);
}

/* ------------------------------- vTendency -------------------------------- */

export interface VTendencyOpts {
  // Window length in ticks/steps (e.g., 20–60).
  window?: number; // default 30
  // Scale envelope (±).
  scale?: number; // default 100
  // Slope gain inside tanh.
  k?: number; // default 1.1
  // Normalizer for slope dispersion (MAD of first differences or stdev).
  normalizer?: "mad" | "stdev"; // default "mad"
}

/**
 * vTendency over a stable series (typically vOuter_t).
 * Regress over last W points; normalize slope by MAD|Δy|.
 * Returns direction/strength/score in your envelope.
 */
export function vTendencyFromSeries(
  series: number[],
  opts: VTendencyOpts = {}
): { direction: number; strength: number; slope: number; r: number; score: number } {
  const W: number = Math.max(3, Math.floor(opts.window ?? 30));
  const S: number = opts.scale ?? 100;
  const k: number = opts.k ?? 1.1;
  const norm = opts.normalizer ?? "mad";

  if (!series?.length || series.length < 2) {
    return { direction: 0, strength: 0, slope: 0, r: 0, score: 0 };
  }
  const start = Math.max(0, series.length - W);
  const y = series.slice(start); // length m

  // linreg on index 0..m-1
  const m = y.length;
  let sx = 0, sy = 0, sxx = 0, sxy = 0, syy = 0;
  for (let i = 0; i < m; i++) {
    const xi = i, yi = y[i];
    sx += xi; sy += yi; sxx += xi * xi; sxy += xi * yi; syy += yi * yi;
  }
  const num = m * sxy - sx * sy;
  const den = m * sxx - sx * sx;
  const slope = den === 0 ? 0 : num / den;
  const rden = Math.sqrt((m * sxx - sx * sx) * (m * syy - sy * sy));
  const r = rden === 0 ? 0 : num / rden;

  // dispersion of first differences
  const diffs: number[] = [];
  for (let i = 1; i < y.length; i++) diffs.push(y[i] - y[i - 1]);

  let D = 0;
  if (norm === "mad") {
    const med = wMedian(diffs);
    const absdev = diffs.map((d) => Math.abs(d - med));
    D = wMedian(absdev);
  } else {
    const mu = mean(diffs);
    const varsum = diffs.reduce((a, d) => a + (d - mu) * (d - mu), 0);
    D = diffs.length > 1 ? Math.sqrt(varsum / (diffs.length - 1)) : 0;
  }
  const z = D > 0 ? slope / D : 0;

  const direction = tanh(k * z); // [-1..1]
  const strength = Math.min(1, Math.max(0, Math.abs(r)));
  const score = clamp(direction * S, -S, S);
  return { direction, strength, slope, r, score };
}

/* --------------------------------- vSwap ---------------------------------- */
/**
 * vSwap (quartile-conditioned, non-parametric):
 * Compare average inner in top vs bottom quartile of tendency over a window.
 *
 * Inputs:
 *  - innerHistScaled: history of aggregate inner (scaled in [-S,S]) for last H ticks
 *  - tendencyHistScaled: matching history of vTendency (scaled in [-S,S]) for last H ticks
 *  - scale S and softness alpha for final tanh
 *
 * Steps:
 *  1) Convert both to unitless [-1..1] by dividing by S.
 *  2) Find Q1/Q3 of tendency; compute mean(inner) where T<=Q1 and where T>=Q3.
 *  3) Q = (mean_top - mean_bottom)/2 in [-1,1].
 *  4) vSwap = S * tanh(alpha * Q).
 */
export function vSwapQuartiles(
  innerHistScaled: number[],
  tendencyHistScaled: number[],
  opts: { scale?: number; alpha?: number } = {}
): { Q: number; score: number; q1: number; q3: number } {
  const S: number = opts.scale ?? 100;
  const alpha: number = opts.alpha ?? 1.2;

  const n = Math.min(innerHistScaled.length, tendencyHistScaled.length);
  if (n < 4) return { Q: 0, score: 0, q1: 0, q3: 0 };

  // unitless series in [-1..1]
  const I = innerHistScaled.slice(-n).map((v) => (S ? v / S : v));
  const T = tendencyHistScaled.slice(-n).map((v) => (S ? v / S : v));

  // compute Q1, Q3 of T
  const sortedT = T.slice().sort((a, b) => a - b);
  const q1 = quantile(sortedT, 0.25);
  const q3 = quantile(sortedT, 0.75);

  // means in tails
  const bot: number[] = [];
  const top: number[] = [];
  for (let i = 0; i < n; i++) {
    if (T[i] <= q1) bot.push(I[i]);
    else if (T[i] >= q3) top.push(I[i]);
  }
  const meanTop = top.length ? mean(top) : 0;
  const meanBot = bot.length ? mean(bot) : 0;

  const Q = clamp((meanTop - meanBot) / 2, -1, 1); // [-1,1]
  const score = clamp(S * tanh(alpha * Q), -S, S);
  return { Q, score, q1, q3 };
}

/**
 * vSwapFromNuclei (optional side-of-mass view):
 * Compare total mass right-vs-left of center across nuclei (bins).
 * Returns score in [-S, S].
 */
export function vSwapFromNuclei(
  nuclei: Nucleus[],
  bins: number,
  opts: { scale?: number; alpha?: number } = {}
): number {
  const S: number = opts.scale ?? 100;
  const alpha: number = opts.alpha ?? 1.0;
  if (!nuclei?.length || bins <= 0) return 0;

  const mid = (bins - 1) / 2;
  let left = 0, right = 0;

  for (let b = 0; b < nuclei.length; b++) {
    const nu = nuclei[b];
    const w = nu.weights && nu.weights.length === nu.values.length ? nu.weights : undefined;
    // treat each sample in this nucleus as unit mass (or weighted)
    for (let i = 0; i < nu.values.length; i++) {
      // map index within the nucleus to its global bin index b
      // if you keep per-sample bin index, adapt as needed; for now use bin b
      const wi = w ? Math.max(0, w[i] || 0) : 1;
      if (b < mid) left += wi;
      else if (b > mid) right += wi;
      else { left += wi / 2; right += wi / 2; }
    }
  }

  const s = Math.abs(left) + Math.abs(right);
  if (!s) return 0;

  const unitless = (right - left) / s; // [-1,1]
  return clamp(S * tanh(alpha * unitless), -S, S);
}

/* --------------------------- Aggregate inner now -------------------------- */
/**
 * Helper to get the aggregate inner (unitless & scaled) at a single tick,
 * from the current nuclei & optional bin shares.
 */
export function aggregateInnerNow(
  nuclei: Nucleus[],
  weights?: ComposeWeights[],
  innerOpts?: VInnerOpts,
  scale: number = 100
): { unitless: number; scaled: number } {
  const S: number = scale;
  const inners = nuclei.map((nu) => vInner(nu, { ...innerOpts, scale: S }));
  const gammas = weights?.map((w) => (Number.isFinite(w?.gamma as number) ? (w!.gamma as number) : 1))
    ?? Array(nuclei.length).fill(1);
  const sumG = sum(gammas) || inners.length || 1;
  const u = inners.reduce((a, v, i) => a + (gammas[i] * (v / S)), 0) / sumG;
  return { unitless: u, scaled: clamp(S * u, -S, S) };
}
