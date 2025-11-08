// src/core/features/str-aux/vectors.ts

/** Basic types (lean & local to STR-AUX) */
export type Series = number[];

/** Optional nuclei shape if you feed from IDHR */
export type Nucleus = { idx: number; weight: number };

/** Normalize an array to sum of absolute weights (avoid div-by-zero). */
function norm1(xs: number[]): number {
  const s = xs.reduce((a, b) => a + Math.abs(b || 0), 0);
  return s > 0 ? s : 1;
}

/** Create symmetric coordinates in [-1, +1] for a vector length. */
function symCoords(n: number): number[] {
  if (n <= 1) return [0];
  const mid = (n - 1) / 2;
  const span = Math.max(1, mid);
  return Array.from({ length: n }, (_, i) => (i - mid) / span);
}

/** vInner: direction of mass along the symmetry axis, emphasizes center. */
export function vInner(weights: number[]): number {
  const n = weights.length;
  if (!n) return 0;
  const x = symCoords(n);
  const s = norm1(weights);
  // emphasize central bins slightly (1 - |x|) so inner dominates
  let acc = 0;
  for (let i = 0; i < n; i++) {
    const gain = 1 - Math.min(1, Math.abs(x[i]));
    acc += (weights[i] || 0) * x[i] * gain;
  }
  // scale to [-1, 1]
  const denom = s / 2; // soft scale
  return Math.max(-1, Math.min(1, acc / (denom || 1)));
}

/** vOuter: tail heaviness and side, emphasizes extremes. */
export function vOuter(weights: number[]): number {
  const n = weights.length;
  if (!n) return 0;
  const x = symCoords(n);
  const s = norm1(weights);
  let acc = 0;
  for (let i = 0; i < n; i++) {
    const gain = Math.pow(Math.abs(x[i]), 1.25); // emphasize outer bins
    acc += (weights[i] || 0) * x[i] * gain;
  }
  const denom = s / 2;
  return Math.max(-1, Math.min(1, acc / (denom || 1)));
}

/** Scaled variants if you prefer a softer response (0..1 magnitude). */
export function vInnerScaled(weights: number[]): number {
  return (Math.abs(vInner(weights)) + vInner(weights)) / 2   // map [-1,1] -> [0,1] preserving sign bias
       - (Math.abs(vInner(weights)) - vInner(weights)) / 2;
}
export function vOuterScaled(weights: number[]): number {
  return (Math.abs(vOuter(weights)) + vOuter(weights)) / 2
       - (Math.abs(vOuter(weights)) - vOuter(weights)) / 2;
}

/** Robust slope → tendency in [-1,1] using MAD scaling. */
export function vTendencyFromSeries(y: Series, window = Math.min(32, y.length)): number {
  if (!y.length || window < 2) return 0;
  const n = Math.min(window, y.length);
  const xs = Array.from({ length: n }, (_, i) => i + 1);
  const ys = y.slice(-n);

  const xBar = xs.reduce((a, b) => a + b, 0) / n;
  const yBar = ys.reduce((a, b) => a + b, 0) / n;
  let num = 0, den = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - xBar;
    num += dx * (ys[i] - yBar);
    den += dx * dx;
  }
  const slope = den ? num / den : 0;

  // MAD scaling for robustness
  const devs = ys.map(v => Math.abs(v - yBar));
  devs.sort((a, b) => a - b);
  const mad = devs[Math.floor(devs.length / 2)] || 1e-12;
  const zSlope = slope / (mad || 1e-12);

  // squash to [-1,1]
  return Math.tanh(zSlope / 3);
}

/** vSwap based on nuclei mass difference (e.g., left vs right of center). */
export function vSwapFromNuclei(nuclei: Nucleus[], bins: number): number {
  if (!nuclei?.length || bins <= 0) return 0;
  const mid = (bins - 1) / 2;
  let left = 0, right = 0;
  for (const n of nuclei) {
    if (n.idx < mid) left += n.weight || 0;
    else if (n.idx > mid) right += n.weight || 0;
    else {
      // center bin: split half/half to avoid bias
      left += (n.weight || 0) / 2;
      right += (n.weight || 0) / 2;
    }
  }
  const s = Math.abs(left) + Math.abs(right);
  if (!s) return 0;
  return Math.max(-1, Math.min(1, (right - left) / s));
}

/** vSwap using quartiles of a sample (mass top vs bottom). */
export function vSwapQuartiles(samples: number[]): number {
  if (!samples?.length) return 0;
  const a = samples.slice().sort((x, y) => x - y);
  const q = (p: number) => a[Math.floor((a.length - 1) * p)];
  const q1 = q(0.25);
  const q3 = q(0.75);
  const med = q(0.5);
  const span = Math.abs(q3 - q1) || Math.abs(med) || 1;
  const score = (q3 - q1) / span;      // 0..2 (ish)
  // orient by median sign to express side
  const sign = med >= 0 ? 1 : -1;
  return Math.max(-1, Math.min(1, sign * Math.tanh(score)));
}

/** quick helper if you need the inner sum for "now". */
export function aggregateInnerNow(weights: number[]): number {
  return vInner(weights);
}
