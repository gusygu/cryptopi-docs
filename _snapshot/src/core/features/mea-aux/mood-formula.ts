// Implements: mood = (vTendency / GFM) + vSwap
// with vTendency in [0.4..1.2], GFM in [0.8..1.2], vSwap in [−0.5..+0.5] (signed)
// plus 6× up/down niches for vTendency, 4× up/down for GFM, 6× up/down for vSwap.

export type MoodFormulaInputs = {
  vTendency: number | null; // trend intensity (signed; foundational)
  GFM: number | null;       // global flow momentum factor (≥0 ideally)
  vSwap: number | null;     // swap velocity (signed)
};

export type MoodBuckets = {
  vTendencyIdx: number; // 0..5 (up), 6..11 (down)
  GFMIdx: number;       // 0..3 (up), 4..7 (down)
  vSwapIdx: number;     // 0..5 (up), 6..11 (down)
};

export function clamp(x: number, lo: number, hi: number) {
  return Math.min(Math.max(x, lo), hi);
}

function binSigned(
  x: number,
  boundaries: number[],
  upCount: number,
  downCount: number
) {
  // boundaries are non-negative increasing, applied to abs(x)
  const a = Math.abs(x);
  let idx = 0;
  while (idx < boundaries.length && a > boundaries[idx]) idx++;
  // idx ∈ [0..boundaries.length] maps to 0..N-1 inside each side
  if (x >= 0) return Math.min(idx, upCount - 1);
  // shift to "down" band space
  return upCount + Math.min(idx, downCount - 1);
}

// --- bucket specs (tuneable, deterministic) ---
const V_TEND_MIN = 0.4, V_TEND_MAX = 1.2; // foundational range
const GFM_MIN = 0.8, GFM_MAX = 1.2;
const V_SWAP_MAX = 0.5; // magnitude cap

// Build equal-width cut points for convenience:
function eqCuts(min: number, max: number, parts: number) {
  const step = (max - min) / parts;
  return Array.from({ length: parts - 1 }, (_, i) => min + step * (i + 1));
}
const vTendCuts = eqCuts(0, V_TEND_MAX, 6); // absolute buckets, zero handled by sign
const gfmCuts   = eqCuts(0, GFM_MAX, 4);
const vSwapCuts = eqCuts(0, V_SWAP_MAX, 6);

// Signed clamps
function clampRanges(i: MoodFormulaInputs) {
  const vTendency = i.vTendency ?? 0;
  const GFM       = i.GFM ?? 1; // neutral if missing
  const vSwap     = i.vSwap ?? 0;

  const vTendencyClamped = Math.sign(vTendency) * clamp(Math.abs(vTendency), 0, V_TEND_MAX);
  const GFMClamped       = clamp(GFM, GFM_MIN, GFM_MAX);
  const vSwapClamped     = Math.sign(vSwap) * clamp(Math.abs(vSwap), 0, V_SWAP_MAX);
  return { vTendencyClamped, GFMClamped, vSwapClamped };
}

export function computeMoodCoeffV1(i: MoodFormulaInputs) {
  const { vTendencyClamped, GFMClamped, vSwapClamped } = clampRanges(i);

  // your formula:
  // mood = (vTendency / GFM) + vSwap
  // Then softly clamp to a sane engine range [0.2 .. 2.0]
  let coeff = ( (vTendencyClamped || 0) / (GFMClamped || 1) ) + (vSwapClamped || 0);
  coeff = clamp(coeff, 0.2, 2.0);

  // resolve “niches”
  const vTendencyIdx = binSigned(vTendencyClamped, vTendCuts, 6, 6);
  const GFMIdx       = binSigned(GFMClamped - 1 /* center around 1.0 */, gfmCuts, 4, 4);
  const vSwapIdx     = binSigned(vSwapClamped, vSwapCuts, 6, 6);

  const buckets: MoodBuckets = { vTendencyIdx, GFMIdx, vSwapIdx };
  return { coeff, buckets };
}
