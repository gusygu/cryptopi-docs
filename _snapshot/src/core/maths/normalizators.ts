// src/core/maths/norm.ts
// Normalization & scaling utilities (unit-safe, NaN-safe, no external deps).

/* ------------------------------ Primitives ------------------------------ */
export const isFiniteNum = (v: unknown): v is number =>
  typeof v === "number" && Number.isFinite(v);

export const clamp = (x: number, lo: number, hi: number) =>
  Math.max(lo, Math.min(hi, x));

export const safeDiv = (num: number, den: number, fallback = 0) =>
  den === 0 ? fallback : num / den;

export const tanh = (x: number) => {
  const e = Math.exp(2 * x);
  return (e - 1) / (e + 1);
};

/* -------------------------------- Stats --------------------------------- */
export const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
export const mean = (xs: number[]) => (xs.length ? sum(xs) / xs.length : 0);

export function stdev(xs: number[]): number {
  const n = xs.length;
  if (n < 2) return 0;
  const m = mean(xs);
  let a = 0;
  for (let i = 0; i < n; i++) {
    const d = xs[i] - m;
    a += d * d;
  }
  return Math.sqrt(a / (n - 1));
}

export function median(xs: number[]): number {
  if (!xs.length) return 0;
  const s = xs.slice().sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

export function mad(xs: number[]): number {
  if (!xs.length) return 0;
  const m = median(xs);
  const dev = xs.map((x) => Math.abs(x - m));
  return median(dev); // raw MAD (optionally ×1.4826 for σ-equiv)
}

export function quantile(sorted: number[], p: number): number {
  if (!sorted.length) return 0;
  const idx = (sorted.length - 1) * p;
  const lo = Math.floor(idx), hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  const a = sorted[lo], b = sorted[hi];
  return a + (b - a) * (idx - lo);
}

/* -------------------------- Fit/Transform APIs -------------------------- */
export interface CenterScale {
  center: number; // location
  scale: number;  // dispersion (>0)
}

/** Mean / stdev fit (parametric). */
export function fitStandard(xs: number[]): CenterScale {
  return { center: mean(xs), scale: stdev(xs) || 1e-9 };
}

/** Median / MAD fit (robust). Use `sigmaEquiv=true` to multiply MAD by 1.4826. */
export function fitRobust(xs: number[], sigmaEquiv = false): CenterScale {
  const m = median(xs);
  const d = mad(xs) * (sigmaEquiv ? 1.4826 : 1);
  return { center: m, scale: d || 1e-9 };
}

/** Z-score using provided center/scale. */
export const zScore = (x: number, cs: CenterScale) =>
  (x - cs.center) / (cs.scale || 1e-9);

/** Map z to [-S, S] via tanh. Keep gain small (0.8..1.5). */
export const zToEnvelope = (z: number, S = 100, gain = 1) =>
  clamp(S * tanh(gain * z), -S, S);

/** One-shot robust z then envelope. */
export function robustScore(x: number, sample: number[], S = 100, gain = 1, sigmaEquiv = false) {
  const cs = fitRobust(sample, sigmaEquiv);
  return zToEnvelope(zScore(x, cs), S, gain);
}

/* ------------------------ Range & Rank Normalizers ----------------------- */
/** Scale x from [inMin,inMax] to [outMin,outMax]. */
export function scaleToRange(x: number, inMin: number, inMax: number, outMin = 0, outMax = 1) {
  if (inMax === inMin) return (outMin + outMax) / 2;
  const t = (x - inMin) / (inMax - inMin);
  return outMin + t * (outMax - outMin);
}

/** Min-max normalize array to [0,1]. */
export function minMax01(xs: number[]) {
  if (!xs.length) return xs;
  let lo = Infinity, hi = -Infinity;
  for (const v of xs) { if (isFiniteNum(v)) { if (v < lo) lo = v; if (v > hi) hi = v; } }
  if (!Number.isFinite(lo) || !Number.isFinite(hi) || lo === hi) return xs.map(() => 0.5);
  return xs.map((v) => scaleToRange(v, lo, hi, 0, 1));
}

/** Winsorize array by quantiles (defaults 1%/99%). */
export function winsorize(xs: number[], pLo = 0.01, pHi = 0.99) {
  const s = xs.slice().sort((a, b) => a - b);
  const lo = quantile(s, pLo), hi = quantile(s, pHi);
  return xs.map((v) => clamp(v, lo, hi));
}

/** Rank-normalize to (0,1) with average ties. */
export function rank01(xs: number[]) {
  const pairs = xs.map((v, i) => ({ v, i })).sort((a, b) => a.v - b.v);
  const ranks = new Array(xs.length).fill(0);
  let j = 0;
  while (j < pairs.length) {
    let k = j + 1;
    while (k < pairs.length && pairs[k].v === pairs[j].v) k++;
    const avg = (j + k - 1) / 2; // average rank for ties
    for (let t = j; t < k; t++) ranks[pairs[t].i] = avg;
    j = k;
  }
  const n = xs.length;
  return ranks.map((r) => (n <= 1 ? 0.5 : r / (n - 1)));
}

/* ----------------------------- Envelope utils ---------------------------- */
/** Expect u in [-1,1], scale to [-S,S]. */
export const toEnvelope = (u: number, S = 100) => clamp(u * S, -S, S);
/** Convert from [-S,S] back to unitless [-1,1]. */
export const fromEnvelope = (v: number, S = 100) => clamp(S ? v / S : v, -1, 1);

/** Generic tanh envelope for any raw score (keeps linear-ish near 0). */
export const squashTanh = (x: number, S = 100, gain = 1) =>
  clamp(S * tanh(gain * x), -S, S);

/* ------------------------------ Matrix helpers --------------------------- */
/** Map over a numeric (or null) matrix safely. */
export function mapMatrix<T extends number | null>(
  M: T[][],
  fn: (v: number, i: number, j: number) => number | null
): (number | null)[][] {
  const out = new Array(M.length);
  for (let i = 0; i < M.length; i++) {
    out[i] = new Array(M[i].length);
    for (let j = 0; j < M[i].length; j++) {
      const v = M[i][j];
      out[i][j] = v == null || !isFiniteNum(v) ? null : fn(v, i, j);
    }
  }
  return out;
}


/* ========================= Normalizers & Denormalizers ========================= */

/** Map x from [inMin,inMax] -> [0,1]. */
export function normalize01(x: number, inMin: number, inMax: number): number {
  return scaleToRange(x, inMin, inMax, 0, 1);
}
/** Inverse: map u in [0,1] back to [outMin,outMax]. */
export function denormalize01(u: number, outMin: number, outMax: number): number {
  return scaleToRange(u, 0, 1, outMin, outMax);
}

/** Map x from [inMin,inMax] -> [-1,1]. */
export function normalizeSym1(x: number, inMin: number, inMax: number): number {
  return scaleToRange(x, inMin, inMax, -1, 1);
}
/** Inverse for [-1,1] back to [outMin,outMax]. */
export function denormalizeSym1(s: number, outMin: number, outMax: number): number {
  return scaleToRange(s, -1, 1, outMin, outMax);
}

/** Map x from [inMin,inMax] -> [0,4]. */
export function normalize04(x: number, inMin: number, inMax: number): number {
  return scaleToRange(x, inMin, inMax, 0, 4);
}
/** Inverse for [0,4] back to [outMin,outMax]. */
export function denormalize04(v: number, outMin: number, outMax: number): number {
  return scaleToRange(v, 0, 4, outMin, outMax);
}

/** Generic: map x from [inMin,inMax] -> [outMin,outMax]. */
export function normalizeToRange(
  x: number,
  inMin: number,
  inMax: number,
  outMin: number,
  outMax: number
): number {
  return scaleToRange(x, inMin, inMax, outMin, outMax);
}

/* ============================= Quantization (levels) ============================= */
/**
 * Quantize a value in [outMin,outMax] to a grid with `levels` distinct values.
 * Example: levels=11 => steps of 1/10 across the target range.
 */
export function quantizeByLevels(
  x: number,
  levels = 11,
  outMin = 0,
  outMax = 1
): number {
  const L = Math.max(2, Math.floor(levels));
  const t = scaleToRange(x, outMin, outMax, 0, 1);
  const q = Math.round(t * (L - 1)) / (L - 1);
  return scaleToRange(q, 0, 1, outMin, outMax);
}

/** Generate the full grid for `levels` values between [outMin,outMax]. */
export function levelsGrid(levels = 11, outMin = 0, outMax = 1): number[] {
  const L = Math.max(2, Math.floor(levels));
  const out: number[] = [];
  for (let i = 0; i < L; i++) out.push(scaleToRange(i / (L - 1), 0, 1, outMin, outMax));
  return out;
}

/* ========================== Base-b fractional “decimals” ========================= */
/**
 * Snap a value to the nearest base-b fractional grid with `digits` places.
 * In base b, one fractional digit => step = b^{-1}; two digits => b^{-2}, etc.
 * Examples (base=11): digits=1 => step 1/11; digits=2 => 1/121.
 */
export function snapToBaseDigits(
  x: number,
  digits = 1,
  outMin = 0,
  outMax = 1,
  base = 11
): number {
  const b = Math.max(2, Math.floor(base));
  const step = 1 / Math.pow(b, Math.max(1, Math.floor(digits)));
  const t = scaleToRange(x, outMin, outMax, 0, 1);
  const q = Math.round(t / step) * step;
  return scaleToRange(q, 0, 1, outMin, outMax);
}

/** Produce the full base-b grid with `digits` fractional places over [outMin,outMax]. */
export function baseDigitsGrid(
  digits = 1,
  outMin = 0,
  outMax = 1,
  base = 11
): number[] {
  const b = Math.max(2, Math.floor(base));
  const step = 1 / Math.pow(b, Math.max(1, Math.floor(digits)));
  const N = Math.round(1 / step);
  const out: number[] = [];
  for (let i = 0; i <= N; i++) out.push(scaleToRange(i * step, 0, 1, outMin, outMax));
  return out;
}


