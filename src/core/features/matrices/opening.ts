// src/core/features/matrices/opening.ts
// Opening grid helper backed by market.klines (Binance-ingested data).

import { db } from "@/core/db/db";

export type OpeningArgs = {
  coins: string[];           // uppercase coin universe
  quote?: string;            // default "USDT"
  appSessionId?: string | null;
  window?: string;           // e.g. "1h"
  openingTs?: number;        // optional override (ms)
};

type Grid = (number | null)[][];
const makeGrid = (n: number) =>
  Array.from({ length: n }, () => Array(n).fill(null as number | null));

const DEFAULT_WINDOW = "1h";

// Optional helper: pull opening timestamp from strategy helper when available.
async function resolveOpeningTs(
  appSessionId: string | null | undefined,
  window: string
): Promise<number | null> {
  try {
    const { rows } = await db.query<{ ts_ms: string }>(
      `select ts_ms from get_session_opening_ts($1::text, $2::text) limit 1`,
      [appSessionId ?? null, window]
    );
    if (rows?.[0]?.ts_ms) return Number(rows[0].ts_ms);
  } catch {
    // helper may not exist; swallow.
  }
  return null;
}

export async function fetchOpeningGridFromView(
  args: OpeningArgs
): Promise<{ ts: number; grid: Grid }> {
  const coins = Array.from(new Set(args.coins.map((c) => c.toUpperCase())));
  const n = coins.length;
  const windowLabel = (args.window ?? DEFAULT_WINDOW).toLowerCase();
  const pivot = (args.quote ?? "USDT").toUpperCase();

  let openingTs = args.openingTs ?? null;
  if (!openingTs) {
    openingTs = await resolveOpeningTs(args.appSessionId ?? null, windowLabel);
  }

  const grid = makeGrid(n);
  if (!n) {
    return { ts: openingTs ?? 0, grid };
  }

  const targetSymbols = new Set<string>();
  for (const coin of coins) {
    if (coin === pivot) continue;
    targetSymbols.add(`${coin}${pivot}`);
    targetSymbols.add(`${pivot}${coin}`);
  }

  if (!targetSymbols.size) {
    return { ts: openingTs ?? 0, grid };
  }

  const startDate = openingTs != null ? new Date(openingTs) : null;
  const candidateWindows = Array.from(new Set([windowLabel, "1m"]));

  const { rows } = await db.query<{
    symbol: string;
    base: string | null;
    quote: string | null;
    close_price: string;
    close_time: string;
    window_label: string;
  }>(
    `
    SELECT
      k.symbol,
      (public._split_symbol(k.symbol)).base AS base,
      (public._split_symbol(k.symbol)).quote AS quote,
      k.close_price,
      k.close_time,
      k.window_label
    FROM market.klines k
    WHERE k.symbol = ANY($1::text[])
      AND k.window_label = ANY($2::text[])
      AND ($3::timestamptz IS NULL OR k.close_time >= $3::timestamptz)
    ORDER BY
      k.symbol,
      CASE WHEN k.window_label = $4 THEN 0 ELSE 1 END,
      k.close_time ASC
    `,
    [Array.from(targetSymbols), candidateWindows, startDate, windowLabel]
  );

  const seen = new Set<string>();
  let effectiveTs = openingTs ?? 0;
  const priceMap = new Map<string, number>();
  priceMap.set(pivot, 1);

  for (const row of rows) {
    const symbol = String(row.symbol ?? "").toUpperCase();
    if (!symbol || seen.has(symbol)) continue;
    const base = String(row.base ?? "").toUpperCase();
    const quote = String(row.quote ?? "").toUpperCase();
    const price = Number(row.close_price);
    if (!Number.isFinite(price)) continue;

    if (quote === pivot) {
      priceMap.set(base, price);
    } else if (base === pivot && Math.abs(price) > 1e-12) {
      priceMap.set(quote, 1 / price);
    } else {
      continue;
    }

    seen.add(symbol);

    const tsMs = Date.parse(row.close_time);
    if (Number.isFinite(tsMs) && tsMs > effectiveTs) {
      effectiveTs = tsMs;
    }
  }

  for (let i = 0; i < n; i++) {
    const baseCoin = coins[i]!;
    const basePrice = priceMap.get(baseCoin) ?? null;
    for (let j = 0; j < n; j++) {
      if (i === j) continue;
      const quoteCoin = coins[j]!;
      const quotePrice = priceMap.get(quoteCoin) ?? null;
      if (
        basePrice != null &&
        quotePrice != null &&
        Number.isFinite(basePrice) &&
        Number.isFinite(quotePrice) &&
        Math.abs(quotePrice) > 1e-12
      ) {
        grid[i][j] = basePrice / quotePrice;
      } else {
        grid[i][j] = null;
      }
    }
  }

  return { ts: effectiveTs, grid };
}

export async function getOpeningPairValue(args: {
  base: string;
  quote: string;
  appSessionId?: string | null;
  window?: string;
  openingTs?: number;
}): Promise<{ ts: number | null; price: number | null }> {
  const { base, quote } = args;
  const { grid, ts } = await fetchOpeningGridFromView({
    coins: [base.toUpperCase(), quote.toUpperCase()],
    quote: quote.toUpperCase(),
    appSessionId: args.appSessionId ?? null,
    window: args.window ?? DEFAULT_WINDOW,
    openingTs: args.openingTs,
  });
  return { ts, price: grid?.[0]?.[1] ?? null };
}
