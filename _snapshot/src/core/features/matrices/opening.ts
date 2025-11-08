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

  let openingTs = args.openingTs ?? null;
  if (!openingTs) {
    openingTs = await resolveOpeningTs(args.appSessionId ?? null, windowLabel);
  }

  const grid = makeGrid(n);
  const pairSymbols: string[] = [];
  const pairIndex = new Map<string, { i: number; j: number }>();

  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      if (i === j) continue;
      const symbol = `${coins[i]}${coins[j]}`;
      pairSymbols.push(symbol);
      pairIndex.set(symbol, { i, j });
    }
  }

  if (!pairSymbols.length) {
    return { ts: openingTs ?? 0, grid };
  }

  const startDate = openingTs != null ? new Date(openingTs) : null;

  const { rows } = await db.query<{
    symbol: string;
    close_price: string;
    close_time: string;
  }>(
    `
    SELECT symbol, close_price, close_time
      FROM market.klines
     WHERE symbol = ANY($1::text[])
       AND window_label = $2
       AND ($3::timestamptz IS NULL OR close_time >= $3::timestamptz)
  ORDER BY symbol, close_time ASC
    `,
    [pairSymbols, windowLabel, startDate]
  );

  const seen = new Set<string>();
  let effectiveTs = openingTs ?? 0;

  for (const row of rows) {
    const symbol = String(row.symbol ?? "").toUpperCase();
    if (!symbol || seen.has(symbol)) continue;
    const idx = pairIndex.get(symbol);
    if (!idx) continue;

    const price = Number(row.close_price);
    if (!Number.isFinite(price)) continue;

    grid[idx.i][idx.j] = price;
    seen.add(symbol);

    const tsMs = Date.parse(row.close_time);
    if (Number.isFinite(tsMs) && tsMs > effectiveTs) {
      effectiveTs = tsMs;
    }
  }

  // Derive missing entries from inverse if available.
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      if (i === j) continue;
      if (grid[i][j] != null) continue;
      const inverse = grid[j][i];
      if (inverse != null && inverse !== 0) {
        grid[i][j] = 1 / inverse;
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
