/**
 * Fetches Binance spot universe and persists it into ext.binance_symbols_preview + market.symbols
 * Requires: DATABASE_URL or PG* env vars
 */

import { Client } from "pg";

const BINANCE_EXCHANGE_INFO = "https://api.binance.com/api/v3/exchangeInfo";

const db = process.env.DATABASE_URL
  ? { connectionString: process.env.DATABASE_URL }
  : {
      host: process.env.PGHOST,
      port: process.env.PGPORT ? Number(process.env.PGPORT) : 5432,
      database: process.env.PGDATABASE,
      user: process.env.PGUSER,
      password: process.env.PGPASSWORD,
    };

const upper = (v: unknown) => String(v ?? "").trim().toUpperCase();

async function fetchSymbols() {
  console.log("[sync-binance-universe] Fetching Binance exchangeInfo ...");
  const res = await fetch(BINANCE_EXCHANGE_INFO);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = await res.json();
  if (!Array.isArray(json.symbols)) throw new Error("Invalid exchangeInfo format");
  const list = json.symbols.filter(
    (s: any) => s.status === "TRADING" && s.isSpotTradingAllowed
  );
  console.log(`[sync-binance-universe] Found ${list.length} spot TRADING symbols`);
  return list.map((s: any) => ({
    symbol: upper(s.symbol),
    base_asset: upper(s.baseAsset),
    quote_asset: upper(s.quoteAsset),
    raw: s,
  }));
}

async function ensureTables(client: Client) {
  console.log("[sync-binance-universe] Ensuring schemas and tables...");
  await client.query(`
    CREATE SCHEMA IF NOT EXISTS ext;
    CREATE SCHEMA IF NOT EXISTS market;

    CREATE TABLE IF NOT EXISTS ext.binance_symbols_preview (
      symbol text PRIMARY KEY,
      base_asset text NOT NULL,
      quote_asset text NOT NULL,
      status text,
      is_spot boolean NOT NULL DEFAULT true,
      raw jsonb NOT NULL DEFAULT '{}'::jsonb,
      fetched_at timestamptz NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS market.symbols (
      symbol text PRIMARY KEY,
      base_asset text,
      quote_asset text,
      status text,
      source text NOT NULL DEFAULT 'binance',
      last_sync timestamptz NOT NULL DEFAULT now(),
      meta jsonb NOT NULL DEFAULT '{}'::jsonb
    );
  `);
}

async function main() {
  const client = new Client(db);
  await client.connect();
  console.log("[sync-binance-universe] Connected to DB");

  try {
    await ensureTables(client);
    const symbols = await fetchSymbols();

    await client.query("BEGIN");

    console.log("[sync-binance-universe] Upserting into ext.binance_symbols_preview...");
    const insertSQL = `
      INSERT INTO ext.binance_symbols_preview(symbol, base_asset, quote_asset, status, is_spot, raw, fetched_at)
      VALUES ($1, $2, $3, 'TRADING', true, $4::jsonb, now())
      ON CONFLICT (symbol) DO UPDATE
        SET base_asset=EXCLUDED.base_asset,
            quote_asset=EXCLUDED.quote_asset,
            status='TRADING',
            raw=EXCLUDED.raw,
            fetched_at=EXCLUDED.fetched_at
    `;
    for (const s of symbols) {
      await client.query(insertSQL, [s.symbol, s.base_asset, s.quote_asset, JSON.stringify(s.raw)]);
    }

    console.log("[sync-binance-universe] Syncing into market.symbols...");
    const syncSQL = `
      INSERT INTO market.symbols(symbol, base_asset, quote_asset, status, last_sync, meta)
      SELECT p.symbol, p.base_asset, p.quote_asset, 'TRADING', now(),
             jsonb_build_object('source','binance','syncedAt', now()::text)
      FROM ext.binance_symbols_preview p
      ON CONFLICT (symbol) DO UPDATE
        SET base_asset=EXCLUDED.base_asset,
            quote_asset=EXCLUDED.quote_asset,
            status=EXCLUDED.status,
            last_sync=EXCLUDED.last_sync,
            meta=EXCLUDED.meta;
    `;
    await client.query(syncSQL);
    await client.query("COMMIT");

    const { rows } = await client.query("SELECT COUNT(*)::int AS cnt FROM market.symbols");
    console.log(`[sync-binance-universe] Done. market.symbols count = ${rows[0].cnt}`);
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("[sync-binance-universe] Error:", err);
  } finally {
    await client.end();
    console.log("[sync-binance-universe] Connection closed.");
  }
}

if (import.meta.url === `file://${process.argv[1]}`) main();
