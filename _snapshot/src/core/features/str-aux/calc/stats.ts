// core/features/str-aux/calc/stats.ts
// STR-AUX descriptive stats + Floating Mode + Vectors + Intrinsic metrics.
// - FloMo (GFM absolute price) from top-K densest IDHR bins (outlier-robust).
// - BFloM (BFM 0..1) normalized within current IDHR return window.
// - Vectors: vInner, vOuter, vTendency, optional vSwap (quartiles).
// - Intrinsic metrics via metrics toolbox: inertia, amp, volt, efficiency.

import {
  computeIdhrBins,
  type IdhrBins,
} from '../frame/idhr'; // sampler only (no MarketPoint import)

import {
  computeVectorSummary,
  type VectorSummary,
} from '../vectors'; // vectors

import {
  inertiaFromReturns,
  ampFromSeries,
  voltFromSeries,
  efficiencyScore,
} from './metrics'; // toolbox

// Local structural type compatible with the sampler's expectation.
type CompatMarketPoint = { ts: number; price: number; volume: number };

export type Point = { ts: number; price: number; w?: number; volume?: number };

export type Stats = {
  // dispersion (price series)
  sigma: number;
  zAbs: number;

  // FloMo — absolute General Floating Mode (price space)
  gfmAbs: number;
  refGfmAbs: number;
  deltaGfmAbs: number;
  deltaGfmPct: number;
  shiftedGfm: boolean;

  // BFloM — normalized (0..1) within current IDHR return span
  bfm01: number;
  refBfm01: number;
  deltaBfm01: number;
  deltaBfmPct: number;
  shiftedBfm: boolean;

  // vectors
  vInner: number;
  vOuter: number;
  tendency: { direction: number; strength: number; slope: number; r: number; score: number };
  vSwap?: { Q: number; score: number; q1: number; q3: number };
  vectors: VectorSummary;

  // intrinsic metrics (toolbox)
  inertia?: { static: number; growth: number; total: number; face: 'static' | 'growth' };
  amp?: number;
  volt?: number;
  efficiency?: number;

  // optional histogram snapshot (present when invoked from sampling pipelines)
  histogram?: {
    counts: number[];
    edges: number[];
    probs: number[];
    densest: number[];
    muR: number;
    sigmaR: number;
    total: number;
  };

  // raw helpers
  opening: number;
  last: number;
  prev: number;
};

type Options = {
  // IDHR controls (merged inside idhr.ts if supported)
  idhr?: { bins?: number; alpha?: number; sMin?: number; smooth?: number; topK?: number };

  // anchors & thresholds
  epsGfmPct?: number; // default 0.35
  epsBfmPct?: number; // default 0.35
  refGfmAbs?: number; // default = openingPx
  refBfm01?: number;  // default = bfm01 of this call

  // vectors
  vScale?: number; // default 100
  tendencyWin?: number; // default 30
  tendencyNorm?: 'mad' | 'stdev'; // default 'mad'
  innerHistScaled?: number[];
  tendencyHistScaled?: number[];

  // metrics windows
  metricsWin?: number; // default 30 for inertia/amp/volt calculations

  // efficiency weights (optional)
  efficiency?: { wTrend?: number; wVolt?: number; wArt?: number; alpha?: number; S?: number };
};

export type StatsOptions = Options;

// ───────────────────────── small utils ─────────────────────────
const EPS = 1e-9;
const avg = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
const robustSigma = (values: number[]) => {
  const m = avg(values);
  const varSum = values.reduce((s, v) => s + (v - m) * (v - m), 0);
  return Math.sqrt(varSum / Math.max(1, values.length));
};
const zAbs = (values: number[], sigma: number) => {
  if (!(sigma > 0)) return 0;
  const m = avg(values);
  return avg(values.map((v) => Math.abs((v - m) / sigma)));
};

// densest-K (works with idhr exposing edges+counts OR centers+counts)
function takeDensestK(
  hist: IdhrBins,
  k = 8
): Array<{ idx: number; count: number; centerR: number }> {
  const centers: number[] = (hist as any).edges ?? (hist as any).centers ?? [];
  const counts: number[] = (hist as any).counts ?? [];
  const pairs = centers.map((c, i) => ({ idx: i, count: counts[i] ?? 0, centerR: c }));
  pairs.sort((a, b) => b.count - a.count);
  return pairs.slice(0, Math.max(1, Math.min(k, pairs.length)));
}
function weightedCenterR(
  _hist: IdhrBins,
  top: Array<{ idx: number; count: number; centerR: number }>
): number {
  const mass = top.reduce((s, x) => s + x.count, 0) || 1;
  return top.reduce((s, x) => s + x.centerR * (x.count / mass), 0);
}

// compute simple log-returns for metrics
function logReturns(prices: number[]): number[] {
  const r: number[] = [];
  for (let i = 1; i < prices.length; i++) {
    const a = prices[i - 1], b = prices[i];
    if (a > 0 && b > 0) r.push(Math.log(b / a));
    else r.push(0);
  }
  return r;
}

// ───────────────────────── main ─────────────────────────
export function computeStats(
  points: Point[],
  opening: { benchmark: number },
  opts: Options = {}
): Stats {
  const epsGfmPct = opts.epsGfmPct ?? 0.35;
  const epsBfmPct = opts.epsBfmPct ?? 0.35;
  const vScale    = opts.vScale    ?? 100;
  const Wm        = Math.max(5, Math.floor(opts.metricsWin ?? 30));
  const topK      = Math.max(1, Math.floor(opts.idhr?.topK ?? 8));

  // price dispersion
  const prices = points.map((p) => Number(p.price)).filter(Number.isFinite);
  const openingPx = Number(opening?.benchmark ?? NaN);
  const openingVal = prices[0] ?? openingPx;
  const last = prices[prices.length - 1] ?? openingPx;
  const prev = prices.length >= 2 ? prices[prices.length - 2] : last;

  const sigma = robustSigma(prices);
  const z = zAbs(prices, sigma);

  // IDHR histogram (return-space) — map to CompatMarketPoint[] (volume required by sampler)
  const idhrPoints: CompatMarketPoint[] = points.map((p) => ({
    ts: Number(p.ts),
    price: Number(p.price),
    volume: Number.isFinite((p as any)?.volume) ? Number((p as any).volume) : 0,
  }));

  const hist = computeIdhrBins(
    idhrPoints,
    {
      benchmark: openingPx,
      pct24h: 0,
      id_pct: 0,
      ts: points[0]?.ts ?? 0,
      layoutHash: '0',
    },
    { bins: opts.idhr?.bins, alpha: opts.idhr?.alpha, sMin: opts.idhr?.sMin, smooth: opts.idhr?.smooth } as any
  );
  const binsCount =
    ((hist as any).edges ?? (hist as any).centers ?? []).length ||
    (hist as any).bins ||
    0;

  // densest-K → weighted center in RETURN space
  const top = takeDensestK(hist, topK);
  const rCenter = weightedCenterR(hist, top); // ln(px/p0)

  // FloMo (absolute price)
  const gfmAbs =
    Number.isFinite(openingPx) && openingPx > 0 ? openingPx * Math.exp(rCenter) : NaN;
  const refGfmAbs = Number.isFinite(opts.refGfmAbs as number)
    ? (opts.refGfmAbs as number)
    : openingPx;
  const deltaGfmAbs =
    Number.isFinite(gfmAbs) && Number.isFinite(refGfmAbs)
      ? gfmAbs - refGfmAbs
      : NaN;
  const deltaGfmPct =
    Number.isFinite(gfmAbs) && refGfmAbs > 0 ? (gfmAbs / refGfmAbs - 1) * 100 : NaN;
  const shiftedGfm = Number.isFinite(deltaGfmPct)
    ? Math.abs(deltaGfmPct) >= epsGfmPct
    : false;

  // BFloM (0..1) within current return window
  const edges = (hist as any).edges ?? (hist as any).centers ?? [];
  const rMin = edges[0] ?? 0, rMax = edges[edges.length - 1] ?? 1;
  const bfm01 = (rCenter - rMin) / Math.max(EPS, rMax - rMin);
  const refBfm01 = Number.isFinite(opts.refBfm01 as number)
    ? (opts.refBfm01 as number)
    : bfm01;
  const deltaBfm01 = bfm01 - refBfm01;
  const deltaBfmPct = deltaBfm01 * 100;
  const shiftedBfm = Math.abs(deltaBfmPct) >= epsBfmPct;

  // vectors
  const vectorSummary = computeVectorSummary(points, {
    bins: binsCount,
    scale: vScale,
    history: {
      inner: opts.innerHistScaled,
      tendency: opts.tendencyHistScaled,
    },
    tendencyWindow: opts.tendencyWin,
    tendencyNorm: opts.tendencyNorm,
  });
  const vInnerAgg = vectorSummary.inner.scaled;
  const vOuterAgg = vectorSummary.outer.scaled;
  const tendency = vectorSummary.tendency.metrics;
  const vSwap = vectorSummary.swap;

  // intrinsic metrics (toolbox) using log-returns
  const r = logReturns(prices);
  const rW = r.slice(-Wm);
  let inertia, amp, volt, efficiency;
  if (rW.length >= 3) {
    inertia = inertiaFromReturns(rW, { window: Wm });
    amp = ampFromSeries(rW, { window: Wm, S: 100 });
    volt = voltFromSeries(rW, { window: Wm, lambda: 1.0, S: 100 });
    efficiency = efficiencyScore(
      {
        tendencyDirection: tendency.direction,
        tendencyStrength: tendency.strength,
        volt01: (volt ?? 0) / 100,
        artificiality01: 0,
      },
      opts.efficiency
    );
  }

  return {
    // dispersion
    sigma,
    zAbs: z,

    // modes
    gfmAbs,
    refGfmAbs,
    deltaGfmAbs,
    deltaGfmPct,
    shiftedGfm,
    bfm01,
    refBfm01,
    deltaBfm01,
    deltaBfmPct,
    shiftedBfm,

    // vectors
    vInner: vInnerAgg,
    vOuter: vOuterAgg,
    tendency,
    vSwap,
    vectors: vectorSummary,

    // metrics
    inertia,
    amp,
    volt,
    efficiency,

    // raw
    opening: Number(openingVal),
    last: Number(last),
    prev: Number(prev),
  };
}
