// src/core/features/str-aux/vectors.ts
// Shared scaffolding for STR-AUX tendency vectors (vInner, vOuter, vTendency, vSwap).
// Consolidates the sampling/binning logic so both stats + API layers can reuse the same path.

import {
  aggregateInnerNow,
  vInner,
  vOuter,
  vTendencyFromSeries,
  vSwapQuartiles,
  vSwapFromNuclei,
  type Nucleus as TendNucleus,
  type ComposeWeights,
} from './calc/tendency';

const EPS = 1e-9;
const clamp01 = (value: number) => Math.max(0, Math.min(1, value));
const clampScale = (value: number, scale: number) =>
  Math.max(-scale, Math.min(scale, value));

export type VectorPoint = {
  price: number;
  ts?: number;
  w?: number;
  weight?: number;
  volume?: number;
};

export type VectorHistory = {
  inner?: number[];
  tendency?: number[];
};

export type VectorOptions = {
  bins: number;
  scale?: number;
  history?: VectorHistory;
  tendencyWindow?: number;
  tendencyNorm?: 'mad' | 'stdev';
  swapAlpha?: number;
};

export type VectorBinSnapshot = {
  index: number;
  scaled: number;
  unitless: number;
  gamma: number;
  share: number;
  samples: number;
};

export type VectorSummary = {
  scale: number;
  bins: number;
  samples: number;
  inner: {
    scaled: number;
    unitless: number;
    weightSum: number;
    perBin: VectorBinSnapshot[];
  };
  outer: {
    scaled: number;
  };
  tendency: {
    window: number;
    normalizer: 'mad' | 'stdev';
    series: number[];
    metrics: {
      direction: number;
      strength: number;
      slope: number;
      r: number;
      score: number;
    };
  };
  swap?: {
    Q: number;
    score: number;
    q1: number;
    q3: number;
  };
  history: {
    inner: number[] | null;
    tendency: number[] | null;
  };
};

const SAFE_SCALE = (scale: number | undefined) =>
  Number.isFinite(scale) && scale ? Number(scale) : 100;

const SAFE_BINS = (bins: number | undefined) =>
  Math.max(1, Math.floor(Number.isFinite(bins) ? (bins as number) : 1));

function sampleWeight(point: VectorPoint): number {
  const primary = point.weight ?? point.w;
  if (Number.isFinite(primary as number)) {
    const value = Number(primary);
    if (value > 0) return value;
  }

  if (Number.isFinite(point.volume as number)) {
    const volume = Number(point.volume);
    if (volume > 0) return volume;
  }

  return 1;
}

function nucleusWeight(nucleus: TendNucleus): number {
  if (nucleus.weights && nucleus.weights.length) {
    return nucleus.weights.reduce(
      (sum, w) => sum + (Number.isFinite(w) && w > 0 ? Number(w) : 0),
      0
    );
  }
  return nucleus.values.length;
}

export function buildVectorNuclei(points: VectorPoint[], binsCount: number): TendNucleus[] {
  const bins = SAFE_BINS(binsCount);
  if (!points?.length) {
    return Array.from({ length: bins }, () => ({ values: [] as number[], weights: [] as number[] }));
  }

  const prices = points
    .map((p) => Number(p.price))
    .filter((price) => Number.isFinite(price));
  if (!prices.length) {
    return Array.from({ length: bins }, () => ({ values: [] as number[], weights: [] as number[] }));
  }

  const pMin = Math.min(...prices);
  const pMax = Math.max(...prices);
  const span = Math.max(EPS, pMax - pMin);

  const buckets = new Map<number, { values: number[]; weights: number[] }>();
  for (const point of points) {
    const price = Number(point.price);
    if (!Number.isFinite(price)) continue;
    const norm = clamp01((price - pMin) / span);
    const index = Math.max(0, Math.min(bins - 1, Math.round(norm * (bins - 1))));
    const weight = sampleWeight(point);
    const entry = buckets.get(index) ?? { values: [], weights: [] };
    entry.values.push(norm);
    entry.weights.push(weight);
    buckets.set(index, entry);
  }

  const nuclei: TendNucleus[] = [];
  for (let idx = 0; idx < bins; idx++) {
    const entry = buckets.get(idx);
    nuclei.push(
      entry
        ? { values: entry.values, weights: entry.weights }
        : { values: [], weights: [] }
    );
  }
  return nuclei;
}

export function computeVectorSummary(
  points: VectorPoint[],
  options: VectorOptions
): VectorSummary {
  const scale = SAFE_SCALE(options.scale);
  const bins = SAFE_BINS(options.bins);
  const safePoints = Array.isArray(points)
    ? points
        .map((raw) => {
          const price = Number((raw as any)?.price);
          if (!Number.isFinite(price)) return null;
          const vectorPoint: VectorPoint = {
            price,
            ts: Number.isFinite((raw as any)?.ts) ? Number((raw as any).ts) : undefined,
            w: Number.isFinite((raw as any)?.w) ? Number((raw as any).w) : undefined,
            weight: Number.isFinite((raw as any)?.weight) ? Number((raw as any).weight) : undefined,
            volume: Number.isFinite((raw as any)?.volume) ? Number((raw as any).volume) : undefined,
          };
          return vectorPoint;
        })
        .filter((p): p is VectorPoint => Boolean(p))
    : [];
  const samples = safePoints.length;

  const chronological = safePoints
    .filter((p) => Number.isFinite(p.ts))
    .sort((a, b) => (Number(a.ts) || 0) - (Number(b.ts) || 0));
  const orderedPoints = chronological.length ? chronological : safePoints;
  const priceSeries = orderedPoints.map((p) => p.price);
  const scaledPriceHistory = deriveScaledPriceHistory(priceSeries, scale);
  const { rawReturns, scaledReturns } = deriveReturnSeries(priceSeries, scale);

  const nuclei = buildVectorNuclei(safePoints, bins);
  const composeWeights: ComposeWeights[] = nuclei.map((nu) => ({ gamma: nucleusWeight(nu) }));
  const weightSum = composeWeights.reduce((sum, w) => {
    const gamma = Number.isFinite(w.gamma as number) ? Math.max(0, w.gamma as number) : 0;
    return sum + gamma;
  }, 0);

  const aggregateInner = aggregateInnerNow(nuclei, composeWeights, undefined, scale);
  const outerScaled = vOuter(nuclei, composeWeights, { scale });

  const historyInner = Array.isArray(options.history?.inner)
    ? options.history!.inner.filter((value) => Number.isFinite(value)).map((value) => Number(value))
    : [];
  const historyTendency = Array.isArray(options.history?.tendency)
    ? options.history!.tendency.filter((value) => Number.isFinite(value)).map((value) => Number(value))
    : [];
  const window = Math.max(3, Math.floor(options.tendencyWindow ?? 30));
  const normalizer = options.tendencyNorm ?? 'mad';

  const derivedTendencySeries = rawReturns.length >= 2 ? rawReturns : null;
  const tendencySeries = derivedTendencySeries ?? historyTendency.concat([outerScaled]);
  const tendencyMetrics = vTendencyFromSeries(tendencySeries, {
    window,
    scale,
    normalizer,
  });
  const derivedInnerHistory =
    rawReturns.length >= 2
      ? scaledPriceHistory.slice(Math.max(0, scaledPriceHistory.length - rawReturns.length))
      : null;
  const derivedTendencyHistory = scaledReturns.length >= 2 ? scaledReturns : null;
  const historyInnerWithCurrent = derivedInnerHistory?.length
    ? derivedInnerHistory
    : historyInner.concat([aggregateInner.scaled]);
  const historyTendencyWithCurrent = derivedTendencyHistory?.length
    ? derivedTendencyHistory
    : historyTendency.concat([tendencyMetrics.score]);

  let swap:
    | {
        Q: number;
        score: number;
        q1: number;
        q3: number;
      }
    | undefined;

  if (historyInnerWithCurrent.length >= 2 && historyTendencyWithCurrent.length >= 2) {
    swap = vSwapQuartiles(historyInnerWithCurrent, historyTendencyWithCurrent, {
      scale,
      alpha: options.swapAlpha ?? 1.2,
    });
  }
  if (!swap) {
    const fallbackScore = vSwapFromNuclei(nuclei, bins, { scale, alpha: options.swapAlpha ?? 1.2 });
    const unitless = scale ? fallbackScore / scale : fallbackScore;
    swap = { Q: unitless, score: fallbackScore, q1: 0, q3: 0 };
  }

  const innerValues = nuclei.map((nu) => vInner(nu, { scale }));
  const perBin: VectorBinSnapshot[] = innerValues.map((scaled, index) => {
    const gamma = Number.isFinite(composeWeights[index].gamma as number)
      ? Math.max(0, composeWeights[index].gamma as number)
      : 0;
    const share = weightSum > 0 ? gamma / weightSum : innerValues.length ? 1 / innerValues.length : 0;
    const samplesInBin = nuclei[index].values.length;
    return {
      index,
      scaled,
      unitless: scale ? scaled / scale : scaled,
      gamma,
      share,
      samples: samplesInBin,
    };
  });

  return {
    scale,
    bins,
    samples,
    inner: {
      scaled: aggregateInner.scaled,
      unitless: aggregateInner.unitless,
      weightSum,
      perBin,
    },
    outer: {
      scaled: outerScaled,
    },
    tendency: {
      window,
      normalizer,
      series: tendencySeries,
      metrics: tendencyMetrics,
    },
    swap,
    history: {
      inner: historyInner.length ? historyInner : null,
      tendency: historyTendency.length ? historyTendency : null,
    },
  };
}

function deriveScaledPriceHistory(prices: number[], scale: number): number[] {
  if (!prices.length) return [];
  const mean = prices.reduce((sum, price) => sum + price, 0) / prices.length;
  const variance =
    prices.reduce((sum, price) => sum + (price - mean) * (price - mean), 0) /
    Math.max(1, prices.length);
  const sigma = Math.sqrt(Math.max(variance, EPS));
  if (!(sigma > 0)) return prices.map(() => 0);
  return prices.map((price) => clampScale(((price - mean) / sigma) * scale, scale));
}

function deriveReturnSeries(prices: number[], scale: number): {
  rawReturns: number[];
  scaledReturns: number[];
} {
  const rawReturns: number[] = [];
  const scaledReturns: number[] = [];
  for (let i = 1; i < prices.length; i++) {
    const prev = prices[i - 1];
    const cur = prices[i];
    if (!(prev > 0 && cur > 0)) continue;
    const logRet = Math.log(cur / prev);
    if (!Number.isFinite(logRet)) continue;
    const raw = logRet * 100;
    rawReturns.push(raw);
    scaledReturns.push(clampScale(raw, scale));
  }
  return { rawReturns, scaledReturns };
}
