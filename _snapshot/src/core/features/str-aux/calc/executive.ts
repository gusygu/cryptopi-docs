// src/core/features/str-aux/calc/executive.ts
import type { SnapshotWithRefs } from "../frame";
import { computeFM } from "@/core/features/str-aux/frame/idhr";                 // IDHR + gfm  :contentReference[oaicite:11]{index=11}
import * as Tend from "@/core/features/str-aux/calc/tendency";       // vectors     :contentReference[oaicite:12]{index=12}
import * as Met from "@/core/features/str-aux/calc/metrics";                    // inertia.    :contentReference[oaicite:13]{index=13}
import {
  getOrInitSymbolSession,
  updateSymbolSession,
  type Snapshot as SessSnap
} from "@/core/features/str-aux/frame/session";                                           // session API :contentReference[oaicite:14]{index=14}
import {
  computeStats,
  type Point as StatPoint,
  type Stats,
  type StatsOptions,
} from "@/core/features/str-aux/calc/stats";
import {
  getSamplingStore,
  summarizeSnapshotWindow,
  type SamplingPoint,
  type SamplingWindowDigest,
  type SamplingWindowKey,
} from "@/core/features/str-aux/sampling";

export type MarketPoint = { ts: number; price: number };
export type OpeningExact = { benchmark: number | null };

function toSeries(payload: SnapshotWithRefs): Record<string, MarketPoint[]> {
  const ts = payload.snapshot.tick.cycleTs ?? payload.frames.cycleStart;
  const out: Record<string, MarketPoint[]> = {};
  for (const p of payload.snapshot.points) {
    const price = Number(p.mid ?? NaN);
    if (!Number.isFinite(price)) continue;
    (out[p.symbol] ??= []).push({ ts, price });
  }
  return out;
}

function openingFromSeries(series: MarketPoint[]): OpeningExact {
  const first = series.find((p) => Number.isFinite(p.price));
  return { benchmark: first ? first.price : null };
}

export type ExecResult = {
  pair: string;
  idhr: { gfm: number | null; sigmaGlobal: number | null; zMeanAbs: number | null; nuclei: any[] };
  vectors: { vInner?: number; vOuter?: number; vTendency?: number };
  metrics: { inertia?: { static: number; growth: number; total: number } | null };
  session: {
    uiEpoch: number; gfmRefPrice: number | null; gfmCalcPrice: number | null; gfmDeltaAbsPct: number;
    snapshot: SessSnap;
  };
};

export function executeCalcAndUpdateSession(
  appSessionId: string,
  payload: SnapshotWithRefs,
  seriesBuffers: Record<string, MarketPoint[]>,  // ring-buffers per "BASE/QUOTE"
  pct24hMap?: Record<string, number>,           // optional 24h %
): ExecResult[] {
  const res: ExecResult[] = [];
  const seriesNow = toSeries(payload);

  for (const [pair, pts] of Object.entries(seriesNow)) {
    // append into buffers
    const buf = seriesBuffers[pair] = (seriesBuffers[pair] ?? []).concat(pts).slice(-3600);

    const opening = openingFromSeries(buf);
    const idhr = computeFM(buf as any, opening as any); // returns { gfm, sigmaGlobal, zMeanAbs, nuclei }  :contentReference[oaicite:15]{index=15}
    const gfmCalcPrice = Number.isFinite(idhr?.gfm) ? idhr.gfm : NaN;

    // simple tendency from last N returns (use z as unitless)
    const returns = buf
      .slice(-60)
      .map((p, i, a) => (i ? 100 * (p.price / a[i - 1].price - 1) : 0))
      .slice(1);
    const vin = returns.length ? Tend.vInner({ values: returns }, { scale: 100 }) : 0;
    const vout = returns.length ? Tend.vOuter([{ values: returns }], undefined, { scale: 100 }) : 0;
    const vt = returns.length ? Tend.vTendencyFromSeries(returns, { scale: 100 }).score : 0;

    // inertia example: from returns only (window=returns.length)
    const inertia = returns.length
      ? Met.inertiaFromReturns(returns, { window: returns.length })
      : null;

    // session update
    const nowTs = payload.frames.cycleEnd ?? payload.snapshot.tick.cycleTs ?? Date.now();
    const priceNow = buf[buf.length - 1]?.price ?? NaN;
    const pct24hNow = Number(pct24hMap?.[pair] ?? 0);

    const ss = getOrInitSymbolSession(appSessionId, pair, opening.benchmark ?? priceNow ?? 0, nowTs);
    const upd = updateSymbolSession(ss, priceNow, nowTs, gfmCalcPrice, pct24hNow);                     // :contentReference[oaicite:17]{index=17}

    res.push({
      pair,
      idhr: {
        gfm: Number.isFinite(idhr.gfm) ? idhr.gfm : null,
        sigmaGlobal: Number.isFinite(idhr.sigmaGlobal) ? idhr.sigmaGlobal : null,
        zMeanAbs: Number.isFinite(idhr.zMeanAbs) ? idhr.zMeanAbs : null,
        nuclei: idhr.nuclei ?? [],
      },
      vectors: { vInner: vin, vOuter: vout, vTendency: vt },
      metrics: { inertia },
      session: {
        uiEpoch: upd.uiEpoch,
        gfmRefPrice: upd.gfmRefPrice,
        gfmCalcPrice: upd.gfmCalcPrice,
        gfmDeltaAbsPct: upd.gfmDeltaAbsPct,
      },
    });
  }

  return res;
}

// ---------------------------------------------------------------------------
// Sampling-backed metrics orchestration (used by /api/str-aux/stats & friends)

export type SampledSeriesMeta = {
  opening: number;
  last: number;
  prev: number;
  lastUpdateTs: number;
  n: number;
};

export type SampledMetricsSuccess = {
  ok: true;
  symbol: string;
  stats: Stats;
  hist: {
    counts: number[];
    edges: number[];
    probs: number[];
    densest: number[];
    muR: number;
    sigmaR: number;
    total: number;
    binWidth: number | null;
    rMin: number | null;
    rMax: number | null;
    returnsPct: number[];
  };
  extrema: { priceMin: number; priceMax: number; benchPctMin: number; benchPctMax: number };
  meta: SampledSeriesMeta;
  sampling: SamplingWindowDigest;
};

export type SampledMetricsError = {
  ok: false;
  symbol: string;
  error: string;
  sampling?: SamplingWindowDigest;
};

export type SampledMetricsResult = SampledMetricsSuccess | SampledMetricsError;

export type SampledMetricsOptions = {
  window: SamplingWindowKey;
  bins: number;
  collect?: boolean;
  stats?: StatsOptions;
};

export async function computeSampledMetricsForSymbol(
  symbol: string,
  opts: SampledMetricsOptions
): Promise<SampledMetricsResult> {
  const sampler = getSamplingStore();
  let snapshot;

  if (opts.collect === false) {
    snapshot = sampler.snapshot(symbol);
  } else {
    try {
      const collected = await sampler.collect(symbol);
      snapshot = collected.snapshot;
    } catch {
      snapshot = sampler.snapshot(symbol);
    }
  }

  const sampling = summarizeSnapshotWindow(snapshot, opts.window);
  const points = sampler.getPoints(symbol, opts.window);
  const series = pointsToStatPoints(points);

  if (!series.length) {
    return {
      ok: false,
      symbol,
      error: "no_points",
      sampling,
    };
  }

  const bins = Math.max(1, Math.floor(opts.bins ?? 1));
  const opening = series[0].price;
  const statsOptions: StatsOptions = {
    ...(opts.stats ?? {}),
    idhr: { ...(opts.stats?.idhr ?? {}), bins },
  };

  const stats = computeStats(series, { benchmark: opening }, statsOptions);
  const priceValues = series.map((p) => p.price);
  const priceMin = Math.min(...priceValues);
  const priceMax = Math.max(...priceValues);
  const benchValues = series.map((p) => benchPct(opening, p.price));
  const benchPctMin = Math.min(...benchValues);
  const benchPctMax = Math.max(...benchValues);
  const histogram = stats.histogram;
  const lastPoint = series[series.length - 1];

  const fallbackHistogram = () => {
    const counts = makeCounts(series, opening, bins);
    const total = counts.reduce((s, c) => s + c, 0);
    const probs = total > 0 ? counts.map((c) => c / total) : counts.map(() => 0);
    return {
      counts,
      edges: [] as number[],
      probs,
      densest: [] as number[],
      muR: 0,
      sigmaR: 0,
      total,
      binWidth: null as number | null,
      rMin: null as number | null,
      rMax: null as number | null,
      returnsPct: [] as number[],
    };
  };

  const histOut = histogram && histogram.counts?.length
    ? {
        counts: histogram.counts,
        edges: histogram.edges,
        probs: histogram.probs,
        densest: histogram.densest,
        muR: histogram.muR,
        sigmaR: histogram.sigmaR,
        total: histogram.total,
        binWidth: histogram.edges.length > 1 ? histogram.edges[1] - histogram.edges[0] : null,
        rMin: histogram.edges[0] ?? null,
        rMax: histogram.edges[histogram.edges.length - 1] ?? null,
        returnsPct: histogram.edges.map((r) => {
          const pct = Math.expm1(r) * 100;
          return Number.isFinite(pct) ? pct : 0;
        }),
      }
    : fallbackHistogram();

  return {
    ok: true,
    symbol,
    stats,
    hist: histOut,
    extrema: { priceMin, priceMax, benchPctMin, benchPctMax },
    meta: {
      opening: stats.opening,
      last: stats.last,
      prev: stats.prev,
      lastUpdateTs: lastPoint.ts,
      n: series.length,
    },
    sampling,
  };
}

export async function computeSampledMetrics(
  symbols: string[],
  opts: SampledMetricsOptions
): Promise<Record<string, SampledMetricsResult>> {
  const pairs = await Promise.all(
    symbols.map(async (sym) => [sym, await computeSampledMetricsForSymbol(sym, opts)] as const)
  );
  const out: Record<string, SampledMetricsResult> = {};
  for (const [sym, result] of pairs) out[sym] = result;
  return out;
}

function pointsToStatPoints(points: SamplingPoint[]): StatPoint[] {
  return points
    .filter((p) => Number.isFinite(p.mid) && p.mid > 0)
    .map((p) => {
      const bid = Number.isFinite(p.bidVolume) ? p.bidVolume : 0;
      const ask = Number.isFinite(p.askVolume) ? p.askVolume : 0;
      return {
        ts: p.ts,
        price: p.mid,
        volume: Math.max(0, bid + ask),
      };
    });
}

function makeCounts(points: StatPoint[], opening: number, totalBins: number): number[] {
  const bins = Math.max(1, totalBins);
  if (!points.length || !(opening > 0)) return Array(bins).fill(0);
  const rets = points.map((p) => Math.log(p.price / opening));
  const min = Math.min(...rets);
  const max = Math.max(...rets);
  const lo = min === max ? min - 1e-6 : min;
  const hi = min === max ? max + 1e-6 : max;
  const counts = Array(bins).fill(0);
  for (const r of rets) {
    const t = (r - lo) / (hi - lo);
    const idx = Math.max(0, Math.min(bins - 1, Math.floor(t * bins)));
    counts[idx] += 1;
  }
  return counts;
}

function benchPct(opening: number, cur: number): number {
  return 100 * ((cur / opening) - 1);
}
