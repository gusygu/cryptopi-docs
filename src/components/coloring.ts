// src/core/features/matrices/coloring.ts
// Shared color helpers for matrices UI components. Keeps palette aligned with CryptoPi theme.

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

export const bgFromSigned = (value?: number | null) => {
  if (value === null || value === undefined || !Number.isFinite(value)) return undefined;
  const v = clamp(value, -1, 1);
  const hue = v >= 0 ? 146 - 30 * (1 - v) : 348 + 30 * (1 + v);
  const sat = 70;
  const light = 24 + 20 * Math.abs(v);
  return `hsl(${hue}deg ${sat}% ${light}%)`;
};

export const ringClass = (isShift?: boolean) =>
  isShift ? "ring-1 ring-amber-400/80 ring-offset-[1px]" : "ring-0 ring-transparent";
