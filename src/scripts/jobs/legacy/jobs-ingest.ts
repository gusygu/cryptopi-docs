/**
 * CryptoPi Ingest Runner (ticker | klines | orderbook)
 * Filters symbols by settings.coin_universe.enabled = true
 *
 * Usage examples:
 *   pnpm dlx tsx src/scripts/jobs/jobs-ingest.ts ticker
 *   pnpm dlx tsx src/scripts/jobs/jobs-ingest.ts klines --interval 30m
 *   pnpm dlx tsx src/scripts/jobs/jobs-ingest.ts orderbook --depth 500
 *   pnpm dlx tsx src/scripts/jobs/jobs-ingest.ts ticker klines --interval 15m
 *
 * Env:
 *   DATABASE_URL (or PGHOST/PGPORT/PGDATABASE/PGUSER/PGPASSWORD)
 */

import { Client } from "pg";

type Job = "ticker" | "klines" | "orderbook";

const ARGV = process.argv.slice(2).map((s) => s.trim());
const JOBS: Job[] = ARGV.filter((t) => ["ticker", "klines", "orderbook"].includes(t)) as Job[];

function argFlag(name: string, fallback?: string) {
  const ix = ARGV.findIndex((a) => a === `--${name}`);
  return ix >= 0 ? ARGV[ix + 1] : fallback;
}

const INTERVAL = argFlag("interval", "30m"); // klines interval
const DEPTH = Number(argFlag("depth", "500")); // orderbook depth (5, 10, 20, 50, 100, 500, 1000, 5000)

const DB =
  process.env.DATABASE_URL
    ? { connectionString: process.env.DATABASE_URL }
    : {
        host: process.env.PGHOST,
        port: process.env.PGPORT ? Number(process.env.PGPORT) : 5432,
        database: process.env.PGDATABASE,
        user: process.env.PGUSER,
        password: process.env.PGPASSWORD,
      };

const U = (v: unknown) => String(v ?? "").trim().toUpperCase();

async function ensureDDL(c: Client) {
  // minimal, idempotent structures used by the jobs
  await c.query(`
    CREATE SCHEMA IF NOT EXISTS market;
    CREATE SCHEMA IF NOT EXISTS settings;

    CREATE TABLE IF NOT EXISTS market.ticker_latest (
      symbol text PRIMARY KEY,
      ts timestamptz NOT NULL,
      price numeric NOT NULL,
      stats jsonb NOT NULL DEFAULT '{}'::jsonb,
      meta  jsonb NOT NULL DEFAULT '{}'::jsonb
    );

    CREATE TABLE IF NOT EXISTS market.klines (
      symbol text NOT NULL,
      window_label text NOT NULL,
      open_time timestamptz NOT NULL,
      close_time timestamptz NOT NULL,
      open numeric NOT NULL,
      high numeric NOT NULL,
      low  numeric NOT NULL,
      close numeric NOT NULL,
      volume numeric NOT NULL,
      PRIMARY KEY (symbol, window_label, open_time)
    );

    -- stores the *latest snapshot* of orderbook for each symbol
    CREATE TABLE IF NOT EXISTS market.orderbook_latest (
      symbol text PRIMARY KEY,
      ts timestamptz NOT NULL,
      last_update_id bigint NOT NULL,
      bids jsonb NOT NULL,   -- [[price,qty], ...]
      asks jsonb NOT NULL,   -- [[price,qty], ...]
      depth int NOT NULL,
      meta jsonb NOT NULL DEFAULT '{}'::jsonb
    );
  `);
}

async function getEnabledSymbols(c: Client): Promise<string[]> {
  const { rows } = await c.query<{ symbol: string }>(`
    SELECT symbol
      FROM settings.coin_universe
     WHERE enabled = true
  `);
  return rows.map((r) => U(r.symbol));
}

/* ----------------------------- Ticker ingest ------------------------------ */

async function ingestTicker(c: Client, symbols: string[]) {
  console.log(`[ingest:ticker] fetching bookTicker for ${symbols.length} enabled symbols...`);

  const res = await fetch("https://api.binance.com/api/v3/ticker/bookTicker");
  if (!res.ok) throw new Error(`ticker HTTP ${res.status}`);
  const book = (await res.json()) as any[];
  const map = new Map(book.map((e) => [U(e.symbol), e]));

  const sql = `
    INSERT INTO market.ticker_latest(symbol, ts, price, stats, meta)
    VALUES ($1, now(), $2, $3::jsonb, $4::jsonb)
    ON CONFLICT (symbol) DO UPDATE
      SET ts = EXCLUDED.ts,
          price = EXCLUDED.price,
          stats = EXCLUDED.stats,
          meta = EXCLUDED.meta
  `;

  let count = 0;
  await c.query("BEGIN");
  try {
    for (const s of symbols) {
      const t = map.get(s);
      if (!t) continue;
      const bid = Number(t.bidPrice);
      const ask = Number(t.askPrice);
      const mid =
        Number.isFinite(bid) && Number.isFinite(ask)
          ? (bid + ask) / 2
          : Number(t.price ?? t.lastPrice ?? NaN);
      if (!Number.isFinite(mid)) continue;

      const stats = {
        bidPrice: Number.isFinite(bid) ? bid : null,
        askPrice: Number.isFinite(ask) ? ask : null,
        bidQty: Number(t.bidQty),
        askQty: Number(t.askQty),
        spread: Number.isFinite(bid) && Number.isFinite(ask) ? ask - bid : null,
      };

      await c.query(sql, [s, mid, JSON.stringify(stats), JSON.stringify(t)]);
      count++;
    }
    await c.query("COMMIT");
  } catch (e) {
    await c.query("ROLLBACK");
    throw e;
  }
  console.log(`[ingest:ticker] upserted ${count} rows.`);
}

/* ----------------------------- Klines ingest ------------------------------ */

async function ingestKlines(c: Client, symbols: string[], interval: string) {
  console.log(`[ingest:klines] interval=${interval}, symbols=${symbols.length}`);
  const sql = `
    INSERT INTO market.klines(symbol, window_label, open_time, close_time, open, high, low, close, volume)
    VALUES ($1,$2,to_timestamp($3/1000.0),to_timestamp($4/1000.0),$5,$6,$7,$8,$9)
    ON CONFLICT (symbol, window_label, open_time) DO NOTHING
  `;

  for (const s of symbols) {
    const url = new URL("https://api.binance.com/api/v3/klines");
    url.searchParams.set("symbol", s);
    url.searchParams.set("interval", interval);
    url.searchParams.set("limit", "500");

    const res = await fetch(url.toString());
    if (!res.ok) {
      console.warn(`[ingest:klines] ${s} HTTP ${res.status} — skipping`);
      continue;
    }
    const arr = (await res.json()) as any[];
    if (!Array.isArray(arr)) continue;

    await c.query("BEGIN");
    try {
      for (const k of arr) {
        const [openTime, open, high, low, close, volume, closeTime] = k;
        await c.query(sql, [s, interval, openTime, closeTime, open, high, low, close, volume]);
      }
      await c.query("COMMIT");
    } catch (e) {
      await c.query("ROLLBACK");
      console.warn(`[ingest:klines] ${s} failed batch — ${String(e)}`);
    }
  }
  console.log(`[ingest:klines] done for ${symbols.length} symbols.`);
}

/* --------------------------- Orderbook ingest ----------------------------- */

async function ingestOrderbook(c: Client, symbols: string[], depth: number) {
  const validDepth = [5, 10, 20, 50, 100, 500, 1000, 5000].includes(depth) ? depth : 500;
  console.log(`[ingest:orderbook] depth=${validDepth}, symbols=${symbols.length}`);

  const upsertSQL = `
    INSERT INTO market.orderbook_latest(symbol, ts, last_update_id, bids, asks, depth, meta)
    VALUES ($1, now(), $2, $3::jsonb, $4::jsonb, $5, $6::jsonb)
    ON CONFLICT (symbol) DO UPDATE
      SET ts = EXCLUDED.ts,
          last_update_id = EXCLUDED.last_update_id,
          bids = EXCLUDED.bids,
          asks = EXCLUDED.asks,
          depth = EXCLUDED.depth,
          meta = EXCLUDED.meta
  `;

  let count = 0;

  for (const s of symbols) {
    const url = new URL("https://api.binance.com/api/v3/depth");
    url.searchParams.set("symbol", s);
    url.searchParams.set("limit", String(validDepth));

    const res = await fetch(url.toString());
    if (!res.ok) {
      console.warn(`[ingest:orderbook] ${s} HTTP ${res.status} — skipping`);
      continue;
    }
    const ob = await res.json(); // { lastUpdateId, bids:[[p,q],...], asks:[[p,q],...] }

    await c.query(upsertSQL, [
      s,
      ob.lastUpdateId ?? 0,
      JSON.stringify(ob.bids ?? []),
      JSON.stringify(ob.asks ?? []),
      validDepth,
      JSON.stringify({ source: "binance", fetchedAt: new Date().toISOString() }),
    ]);
    count++;
  }
  console.log(`[ingest:orderbook] upserted ${count} snapshots.`);
}

/* --------------------------------- Main ----------------------------------- */

async function main() {
  if (!JOBS.length) {
    console.log("Usage: jobs-ingest.ts <ticker|klines|orderbook> [--interval 30m] [--depth 500]");
    process.exit(1);
  }

  const client = new Client(DB as any);
  await client.connect();
  console.log(`[ingest] connected to DB`);

  try {
    await ensureDDL(client);
    const symbols = await getEnabledSymbols(client);

    if (!symbols.length) {
      console.warn(`[ingest] 0 enabled symbols in settings.coin_universe — nothing to do.`);
      return;
    }

    if (JOBS.includes("ticker")) {
      await ingestTicker(client, symbols);
    }
    if (JOBS.includes("klines")) {
      await ingestKlines(client, symbols, INTERVAL);
    }
    if (JOBS.includes("orderbook")) {
      await ingestOrderbook(client, symbols, DEPTH);
    }
  } finally {
    await client.end();
    console.log(`[ingest] done.`);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  // Node 18+ has global fetch
   
  main().catch((err) => {
    console.error("[ingest] fatal", err);
    process.exit(1);
  });
}
