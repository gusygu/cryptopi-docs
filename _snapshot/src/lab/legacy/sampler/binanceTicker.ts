"use server";

import type { PoolClient } from "pg";
import { withClient } from "@/core/db/db";

type TickerPayload = Record<string, unknown>;

type RunnerState = {
  running: boolean;
  pending: boolean;
  timer: NodeJS.Timeout | null;
  startedAt: number | null;
  lastRunAt: number | null;
  nextRunAt: number | null;
  lastProcessed: number;
  lastSeen: number;
  lastError: string | null;
  intervalMs: number;
  runCount: number;
  stopOnError: boolean;
};

type StartResult =
  | { ok: true; status: RunnerStatus }
  | { ok: false; error: string; status: RunnerStatus };

type StopResult =
  | { ok: true; status: RunnerStatus }
  | { ok: false; error: string; status: RunnerStatus };

export type RunnerStatus = {
  running: boolean;
  pending: boolean;
  intervalMs: number;
  startedAt: number | null;
  lastRunAt: number | null;
  nextRunAt: number | null;
  lastProcessed: number;
  lastSeen: number;
  runCount: number;
  lastError: string | null;
  stopOnError: boolean;
};

const DEFAULT_INTERVAL_MS = 60_000;
const MIN_INTERVAL_MS = 5_000;

const state: RunnerState = {
  running: false,
  pending: false,
  timer: null,
  startedAt: null,
  lastRunAt: null,
  nextRunAt: null,
  lastProcessed: 0,
  lastSeen: 0,
  lastError: null,
  intervalMs: DEFAULT_INTERVAL_MS,
  runCount: 0,
  stopOnError: false,
};

const toNumber = (value: unknown): number | null => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim().length) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
};

const toBoolean = (value: unknown): boolean => {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    return normalized === "true" || normalized === "1" || normalized === "yes";
  }
  if (typeof value === "number") {
    return value !== 0;
  }
  return false;
};

const resolveIntervalMs = (payload: TickerPayload): number => {
  const candidates = [
    payload.intervalMs,
    payload.interval_ms,
    payload.interval,
    payload.period,
    payload.cadence,
  ];

  for (const candidate of candidates) {
    const parsed = toNumber(candidate);
    if (parsed !== null && parsed >= MIN_INTERVAL_MS) {
      return Math.floor(parsed);
    }
  }

  return DEFAULT_INTERVAL_MS;
};

function computeMidPrice(entry: any): number | null {
  const rawBid = toNumber(entry?.bidPrice ?? entry?.bid ?? entry?.b);
  const rawAsk = toNumber(entry?.askPrice ?? entry?.ask ?? entry?.a);
  const rawPrice = toNumber(
    entry?.price ?? entry?.lastPrice ?? entry?.p ?? entry?.c,
  );

  const bid = rawBid ?? undefined;
  const ask = rawAsk ?? undefined;

  if (typeof bid === "number" && typeof ask === "number") {
    return (bid + ask) / 2;
  }
  if (typeof bid === "number") return bid;
  if (typeof ask === "number") return ask;
  if (typeof rawPrice === "number") return rawPrice;
  return null;
}

async function fetchBookTicker(): Promise<Map<string, any>> {
  const response = await fetch(
    "https://api.binance.com/api/v3/ticker/bookTicker",
    { cache: "no-store" },
  );
  if (!response.ok) {
    throw new Error(
      `bookTicker fetch failed (${response.status} ${response.statusText})`,
    );
  }
  const json = await response.json();
  if (!Array.isArray(json)) {
    throw new Error("Unexpected bookTicker payload (expected array)");
  }
  const map = new Map<string, any>();
  for (const entry of json) {
    const symbol = String(entry?.symbol ?? "").trim().toUpperCase();
    if (!symbol) continue;
    map.set(symbol, entry);
  }
  return map;
}

async function persistSnapshot(
  client: PoolClient,
  bookTicker: Map<string, any>,
): Promise<{ processed: number; seen: number }> {
  const { rows } = await client.query<{
    symbol: string;
    base_asset: string | null;
    quote_asset: string | null;
  }>(
    `
      SELECT symbol, base_asset, quote_asset
        FROM settings.coin_universe
       WHERE enabled = true
    ORDER BY sort_order NULLS LAST, symbol
    `,
  );

  if (!rows.length) {
    return { processed: 0, seen: 0 };
  }

  let processed = 0;

  await client.query("BEGIN");
  try {
    for (const row of rows) {
      const symbol = String(row.symbol ?? "").trim().toUpperCase();
      if (!symbol) continue;

      const ticker = bookTicker.get(symbol);
      if (!ticker) continue;

      const price = computeMidPrice(ticker);
      if (!Number.isFinite(price)) continue;

      const bid = toNumber(ticker?.bidPrice ?? ticker?.bid);
      const ask = toNumber(ticker?.askPrice ?? ticker?.ask);

      const stats = {
        bidPrice: bid ?? null,
        askPrice: ask ?? null,
        spread:
          typeof bid === "number" && typeof ask === "number"
            ? ask - bid
            : null,
      };

      await client.query(`SELECT market.ensure_symbol($1)`, [symbol]);

      await client.query(
        `
          INSERT INTO market.ticker_latest(symbol, ts, price, stats, meta)
          VALUES ($1,$2,$3,$4::jsonb,$5::jsonb)
          ON CONFLICT (symbol) DO UPDATE
            SET ts    = EXCLUDED.ts,
                price = EXCLUDED.price,
                stats = EXCLUDED.stats,
                meta  = EXCLUDED.meta
        `,
        [
          symbol,
          new Date(),
          price,
          JSON.stringify(stats),
          JSON.stringify(ticker),
        ],
      );

      processed += 1;
    }

    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }

  return { processed, seen: rows.length };
}

async function runCycle(): Promise<void> {
  if (!state.running || state.pending) return;
  state.pending = true;

  try {
    const { processed, seen } = await withClient(async (client) => {
      const bookTicker = await fetchBookTicker();
      return persistSnapshot(client, bookTicker);
    });

    state.lastSeen = seen;
    state.lastProcessed = processed;
    state.lastRunAt = Date.now();
    state.runCount += 1;
    state.lastError = null;
  } catch (error) {
    state.lastError =
      error instanceof Error ? error.message : String(error ?? "unknown error");
    if (state.stopOnError) {
      stopTicker();
    }
  } finally {
    state.pending = false;
  }
}

function scheduleNext() {
  if (!state.running) return;

  if (state.timer) {
    clearTimeout(state.timer);
    state.timer = null;
  }

  state.nextRunAt = Date.now() + state.intervalMs;
  state.timer = setTimeout(() => {
    state.timer = null;
    runCycle()
      .catch(() => {
        // runCycle swallows errors unless stopOnError is true.
      })
      .finally(() => scheduleNext());
  }, state.intervalMs);
}

function snapshot(): RunnerStatus {
  return {
    running: state.running,
    pending: state.pending,
    intervalMs: state.intervalMs,
    startedAt: state.startedAt,
    lastRunAt: state.lastRunAt,
    nextRunAt: state.nextRunAt,
    lastProcessed: state.lastProcessed,
    lastSeen: state.lastSeen,
    runCount: state.runCount,
    lastError: state.lastError,
    stopOnError: state.stopOnError,
  };
}

export function getStatus(): RunnerStatus {
  return snapshot();
}

export function startTicker(payload: TickerPayload = {}): StartResult {
  if (state.running) {
    return {
      ok: false,
      error: "Ticker already running",
      status: snapshot(),
    };
  }

  state.intervalMs = resolveIntervalMs(payload);
  state.stopOnError = toBoolean(
    payload.stopOnError ?? payload.stop_on_error ?? false,
  );
  state.running = true;
  state.startedAt = Date.now();
  state.lastRunAt = null;
  state.nextRunAt = null;
  state.lastProcessed = 0;
  state.lastSeen = 0;
  state.runCount = 0;
  state.lastError = null;

  runCycle()
    .catch(() => {
      // runCycle handles error bookkeeping; nothing to do here.
    })
    .finally(() => scheduleNext());

  return { ok: true, status: snapshot() };
}

export function stopTicker(): StopResult {
  if (!state.running) {
    return {
      ok: false,
      error: "Ticker is not running",
      status: snapshot(),
    };
  }

  state.running = false;
  state.pending = false;
  state.nextRunAt = null;

  if (state.timer) {
    clearTimeout(state.timer);
    state.timer = null;
  }

  return { ok: true, status: snapshot() };
}
