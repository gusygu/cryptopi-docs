export const clamp = (x: number, lo = -Infinity, hi = Infinity) =>
  Math.min(Math.max(x, lo), hi);

export const nz = (x: number, eps = 1e-9) => (Math.abs(x) < eps ? (x >= 0 ? eps : -eps) : x);

export const safeDiv = (a: number, b: number, eps = 1e-9) => a / nz(b, eps);
