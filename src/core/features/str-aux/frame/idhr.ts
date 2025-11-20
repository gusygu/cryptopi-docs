// src/lab/str-aux/idhr.ts
// Deterministic IDHR histogram (with exact bin control) + Floating Mode metrics.
// - Each function merges config locally into `C` (fixes “C is not defined”).
// - `totalBins` enables exact-bin sizing (e.g., 128).
// - Returns Floating Mode (gfm) + basic shape stats.
// - Nuclei now match your repo’s Nucleus type: { binIndex, density, firstDegree, secondDegree }.

import type {
  MarketPoint,
  OpeningExact,
  Nucleus,
  IdhrResult,
} from '../../../../../lab/legacy/auxiliary/str-aux/types';

// ---------- Config & Types ----------

export type IdhrConfig = {
  alpha: number;            // span multiplier around mean (σ · α)
  sMin: number;             // sigma floor to avoid collapse
  topN: number;             // number of nuclei to keep
  primaryBins: number;      // coarse bins
  secondaryBins: number;    // fine bins per coarse bin
  selectedBins: number;     // number of fine bins retained
  totalBins?: number;       // optional override for total bins
};

export const DEFAULT_IDHR: IdhrConfig = {
  alpha: 2.5,
  sMin: 1e-6,
  topN: 3,
  primaryBins: 16,
  secondaryBins: 16,
  selectedBins: 16,
};

export type IdhrBins = {
  edges: number[];    // centers for each sub-bin
  counts: number[];   // counts after masking outliers
  probs: number[];    // probability mass of selected bins
  muR: number;
  stdR: number;
  sigmaGlobal: number; // alias to stdR
  selectedBins: number[];
  selectedPrimaries: number[];
  primaryBins: number;
  secondaryBins: number;
  binWidth: number;
  range: { min: number; max: number };
};

// ---------- Utils ----------

function clamp(n: number, lo: number, hi: number) {
  return n < lo ? lo : n > hi ? hi : n;
}
function mean(xs: number[]) {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
}
function stdev(xs: number[]) {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  const v = xs.reduce((acc, x) => acc + (x - m) ** 2, 0) / (xs.length - 1);
  return Math.sqrt(Math.max(0, v));
}
function linspace(min: number, max: number, n: number) {
  if (n <= 1) return [min];
  const step = (max - min) / (n - 1);
  return Array.from({ length: n }, (_, i) => min + i * step);
}
function argMax(xs: number[]) {
  let idx = 0, best = -Infinity;
  for (let i = 0; i < xs.length; i++) if (xs[i] > best) { best = xs[i]; idx = i; }
  return idx;
}
function smooth1d(xs: number[], k = 3) {
  const n = xs.length;
  if (n === 0 || k <= 1) return xs.slice();
  const half = Math.floor(k / 2);
  const out = new Array(n).fill(0);
  for (let i = 0; i < n; i++) {
    let s = 0, c = 0;
    for (let j = i - half; j <= i + half; j++) if (j >= 0 && j < n) { s += xs[j]; c++; }
    out[i] = s / (c || 1);
  }
  return out;
}

// ---------- Core: computeIdhrBins ----------

export function computeIdhrBins(
  points: MarketPoint[],
  opening: OpeningExact,
  cfg: Partial<IdhrConfig> = {},
): IdhrBins {
  const C: IdhrConfig = { ...DEFAULT_IDHR, ...cfg };
  const p0 = Number(opening?.benchmark ?? 0);
  const returns: number[] = [];
  for (const p of points) {
    const px = Number(p?.price ?? 0);
    if (Number.isFinite(px) && px > 0 && Number.isFinite(p0) && p0 > 0) {
      returns.push(Math.log(px / p0));
    }
  }

  let primaryBins = Math.max(1, Math.floor(C.primaryBins ?? DEFAULT_IDHR.primaryBins));
  let secondaryBins = Math.max(1, Math.floor(C.secondaryBins ?? DEFAULT_IDHR.secondaryBins));
  if (C.totalBins && C.totalBins > 0) {
    const total = Math.max(1, Math.floor(C.totalBins));
    primaryBins = Math.max(1, Math.floor(total / secondaryBins));
    secondaryBins = Math.max(1, Math.floor(total / primaryBins));
  }
  const bins = Math.max(1, primaryBins * secondaryBins);
  const selectedBins = Math.max(1, Math.min(C.selectedBins ?? DEFAULT_IDHR.selectedBins, bins));

  if (!returns.length) {
    return {
      edges: new Array(bins).fill(0),
      counts: new Array(bins).fill(0),
      probs: new Array(bins).fill(0),
      muR: 0,
      stdR: C.sMin,
      sigmaGlobal: C.sMin,
      selectedBins: [],
      primaryBins,
      secondaryBins,
      binWidth: 0,
      range: { min: 0, max: 0 },
    };
  }

  let spanMin = Math.min(...returns);
  let spanMax = Math.max(...returns);
  if (!(spanMax > spanMin)) {
    const mu0 = mean(returns);
    const sd0 = Math.max(stdev(returns), C.sMin);
    const span = Math.max(sd0 * C.alpha, 1e-6);
    spanMin = mu0 - span;
    spanMax = mu0 + span;
  }
  if (!(spanMax > spanMin)) {
    spanMin -= 1e-6;
    spanMax += 1e-6;
  }
  const totalRange = spanMax - spanMin;
  const subWidth = totalRange / bins;
  const edges = new Array(bins).fill(0).map((_, i) => spanMin + (i + 0.5) * subWidth);
  const counts = new Array(bins).fill(0);
  const assignments: number[] = new Array(returns.length);

  const toIndex = (value: number) => {
    if (!Number.isFinite(value)) return 0;
    if (value <= spanMin) return 0;
    if (value >= spanMax) return bins - 1;
    const raw = Math.floor((value - spanMin) / subWidth);
    return clamp(raw, 0, bins - 1);
  };

  for (let i = 0; i < returns.length; i++) {
    const idx = toIndex(returns[i]);
    counts[idx] += 1;
    assignments[i] = idx;
  }

  const ranked = counts
    .map((v, i) => ({ v, i }))
    .sort((a, b) => (b.v === a.v ? a.i - b.i : b.v - a.v));
  const topEntries = ranked.slice(0, selectedBins);
  const selectedSubBins = topEntries.map((entry) => entry.i);
  const selectedPrimariesSet = new Set(
    topEntries.map((entry) => Math.floor(entry.i / secondaryBins))
  );
  const activeSubBins = new Set<number>();
  for (const primary of selectedPrimariesSet) {
    for (let j = 0; j < secondaryBins; j++) {
      activeSubBins.add(primary * secondaryBins + j);
    }
  }
  const maskedCounts = counts.map((c, idx) => (activeSubBins.has(idx) ? c : 0));

  const totalSelected = maskedCounts.reduce((a, b) => a + b, 0);
  const probs = maskedCounts.map((c) => (totalSelected > 0 ? c / totalSelected : 0));

  const inlierReturns: number[] = [];
  assignments.forEach((bin, idx) => {
    if (activeSubBins.has(bin)) inlierReturns.push(returns[idx]);
  });
  const inliers = inlierReturns.length ? inlierReturns : returns;
  const muR = mean(inliers);
  const stdR = Math.max(stdev(inliers), C.sMin);

  return {
    edges,
    counts: maskedCounts,
    probs,
    muR,
    stdR,
    sigmaGlobal: stdR,
    selectedBins: selectedSubBins,
    selectedPrimaries: Array.from(selectedPrimariesSet),
    primaryBins,
    secondaryBins,
    binWidth: subWidth,
    range: { min: spanMin, max: spanMax },
  };
}

// ---------- Nuclei (peak extraction) ----------

export function extractNuclei(bins: IdhrBins, k: number): Nucleus[] {
  const sm = smooth1d(bins.counts, 5);
  const n = sm.length;

  // central differences for 1st/2nd derivatives
  const first: number[] = new Array(n).fill(0);
  const second: number[] = new Array(n).fill(0);
  for (let i = 1; i < n - 1; i++) {
    first[i] = (sm[i + 1] - sm[i - 1]) / 2;
    second[i] = sm[i + 1] - 2 * sm[i] + sm[i - 1];
  }

  // simple local maxima
  const peaks: Array<{ i: number; v: number }> = [];
  for (let i = 1; i < n - 1; i++) {
    if (sm[i] > sm[i - 1] && sm[i] > sm[i + 1]) peaks.push({ i, v: sm[i] });
  }
  peaks.sort((a, b) => b.v - a.v);
  const top = peaks.slice(0, Math.max(1, k));

  const total = bins.counts.reduce((a, b) => a + b, 0) || 1;

  // match your Nucleus type exactly
  const nuclei: Nucleus[] = top.map(({ i, v }) => ({
    binIndex: i,
    density: v / total,
    firstDegree: first[i] ?? 0,
    secondDegree: second[i] ?? 0,
  }));

  return nuclei;
}

// ---------- Floating Mode (metrics) ----------

export function computeFM(
  points: MarketPoint[],
  opening: OpeningExact,
  cfg: Partial<IdhrConfig> = {},
) {
  const C: IdhrConfig = { ...DEFAULT_IDHR, ...cfg };
  const hist = computeIdhrBins(points, opening, C);

  const modeIdx = argMax(hist.counts);
  const gfm = hist.edges[modeIdx] ?? 0;

  const p0 = Number(opening?.benchmark ?? 0);
  const rets: number[] = [];
  for (const p of points) {
    const px = Number(p?.price ?? 0);
    if (Number.isFinite(px) && px > 0 && Number.isFinite(p0) && p0 > 0) {
      rets.push(Math.log(px / p0));
    }
  }

  const sigma = hist.sigmaGlobal;
  const zAbs = rets.length
    ? rets.reduce((a, r) => a + Math.abs((r - hist.muR) / (sigma || 1)), 0) / rets.length
    : 0;

  // crude inner/outer mass around the mode
  const leftCount  = hist.counts.slice(0, modeIdx).reduce((a, b) => a + b, 0);
  const rightCount = hist.counts.slice(modeIdx + 1).reduce((a, b) => a + b, 0);
  const vInner = Math.max(0, Math.min(leftCount, rightCount));
  const vOuter = Math.max(0, leftCount + rightCount - vInner);

  // histogram roughness indicators
  const center = hist.muR;
  const inertia = rets.reduce((acc, r) => acc + (r - center) ** 2, 0) / (rets.length || 1);
  const sm = smooth1d(hist.counts, 3);
  let disruption = 0;
  for (let i = 1; i < sm.length; i++) disruption += Math.abs(sm[i] - sm[i - 1]);
  disruption /= (sm.length || 1);

  const nuclei = extractNuclei(hist, C.topN);

  return {
    gfm,
    confidence: 1 / (1 + zAbs),
    inertia,
    disruption,
    zMeanAbs: zAbs,
    sigmaGlobal: sigma,
    vInner,
    vOuter,
    nuclei, // matches Nucleus type used in your repo
  };
}

// ---------- Helpers ----------

export function computeIdhrBinsN(
  points: MarketPoint[],
  opening: OpeningExact,
  cfg: Partial<IdhrConfig> = {},
  N = 128
) {
  return computeIdhrBins(points, opening, { ...cfg, totalBins: N });
}

export function serializeIdhr(idhr: IdhrBins) {
  return {
    edges: idhr.edges,
    counts: idhr.counts,
    probs: idhr.probs,
    muR: idhr.muR,
    stdR: idhr.stdR,
    sigmaGlobal: idhr.sigmaGlobal,
    selectedBins: idhr.selectedBins,
    selectedPrimaries: idhr.selectedPrimaries,
    primaryBins: idhr.primaryBins,
    secondaryBins: idhr.secondaryBins,
    binWidth: idhr.binWidth,
    range: idhr.range,
  };
}

// Keep buildStrAux compatibility if it imports { idhr }
export function idhr(
  points: MarketPoint[],
  opening: OpeningExact,
  cfg: Partial<IdhrConfig> = {}
): IdhrResult {
  const bins = computeIdhrBins(points, opening, cfg);
  const nuclei = extractNuclei(bins, (cfg.topN ?? DEFAULT_IDHR.topN));
  return { nuclei, sampleFirstDegrees: [], outlierCount: 0 };
}
