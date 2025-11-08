// src/core/features/str-aux/calc/panel.ts
// Helpers that transform sampled metrics into the shape consumed by the stats endpoint / UI.

import {
  computeSampledMetricsForSymbol,
  computeSampledMetrics,
  type SampledMetricsOptions,
  type SampledMetricsResult,
  type SampledMetricsSuccess,
} from "@/core/features/str-aux/calc/executive";
import type { Stats } from "@/core/features/str-aux/calc/stats";
import type { SamplingWindowDigest } from "@/core/features/str-aux/sampling";

export type TickerSnapshot = {
  price?: number | null;
  pct24h?: number | null;
};

export type SymbolStatsMeta = {
  opening: number;
  last: number;
  prev: number;
  lastUpdateTs: number;
  n: number;
};

export type SymbolStatsCards = {
  opening: { benchmark: number; pct24h?: number | null };
  live: { benchmark: number; pct_drv: number; pct24h?: number | null };
};

export type SymbolStatsPanelSuccess = {
  ok: true;
  symbol: string;
  stats: Stats;
  hist: SampledMetricsSuccess["hist"];
  extrema: { priceMin: number; priceMax: number; benchPctMin: number; benchPctMax: number };
  sampling: SamplingWindowDigest;
  meta: SymbolStatsMeta;
  cards: SymbolStatsCards;
};

export type SymbolStatsPanelError = {
  ok: false;
  symbol: string;
  error: string;
  sampling?: SamplingWindowDigest;
};

export type SymbolStatsPanel = SymbolStatsPanelSuccess | SymbolStatsPanelError;

export function toSymbolStatsPanel(
  symbol: string,
  result: SampledMetricsResult,
  ticker?: TickerSnapshot
): SymbolStatsPanel {
  if (!result.ok) {
    return {
      ok: false,
      symbol,
      error: result.error,
      sampling: result.sampling,
    };
  }

  return sampledSuccessToPanel(symbol, result, ticker);
}

export async function buildSymbolStatsPanel(
  symbol: string,
  opts: SampledMetricsOptions,
  ticker?: TickerSnapshot
): Promise<SymbolStatsPanel> {
  const result = await computeSampledMetricsForSymbol(symbol, opts);
  return toSymbolStatsPanel(symbol, result, ticker);
}

export async function buildSymbolsStatsPanel(
  symbols: string[],
  opts: SampledMetricsOptions,
  tickers?: Record<string, TickerSnapshot>
): Promise<Record<string, SymbolStatsPanel>> {
  const entries = await Promise.all(
    symbols.map(async (symbol) => {
      const panel = await buildSymbolStatsPanel(symbol, opts, tickers?.[symbol]);
      return [symbol, panel] as const;
    })
  );
  return Object.fromEntries(entries);
}

export { computeSampledMetricsForSymbol, computeSampledMetrics };
export type { SampledMetricsOptions, SampledMetricsResult, SampledMetricsSuccess };

function sampledSuccessToPanel(
  symbol: string,
  success: SampledMetricsSuccess,
  ticker?: TickerSnapshot
): SymbolStatsPanelSuccess {
  const pct24h = Number.isFinite(Number(ticker?.pct24h))
    ? Number(ticker?.pct24h)
    : undefined;
  const cards = buildCards(success.meta, pct24h);
  const meta: SymbolStatsMeta = {
    opening: success.meta.opening,
    last: success.meta.last,
    prev: success.meta.prev,
    lastUpdateTs: success.meta.lastUpdateTs,
    n: success.meta.n,
  };

  return {
    ok: true,
    symbol,
    stats: success.stats,
    hist: success.hist,
    extrema: success.extrema,
    sampling: success.sampling,
    meta,
    cards,
  };
}

function buildCards(meta: SampledMetricsSuccess["meta"], pct24h?: number) {
  return {
    opening: { benchmark: meta.opening, pct24h },
    live: {
      benchmark: meta.last,
      pct_drv: pctDrv(meta.prev, meta.last, meta.n),
      pct24h,
    },
  };
}

function pctDrv(prev: number, cur: number, n: number): number {
  if (!(n > 1) || !Number.isFinite(prev) || !Number.isFinite(cur) || prev === 0) {
    return 0;
  }
  return 100 * ((cur / prev) - 1);
}
