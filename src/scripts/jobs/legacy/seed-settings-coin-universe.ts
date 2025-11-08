/**
 * Seeds settings.coin_universe from market.symbols
 * Options: --usdt-only
 */

import { Client } from "pg";

const ONLY_USDT = process.argv.includes("--usdt-only");

const db = process.env.DATABASE_URL
  ? { connectionString: process.env.DATABASE_URL }
  : {
      host: process.env.PGHOST,
      port: process.env.PGPORT ? Number(process.env.PGPORT) : 5432,
      database: process.env.PGDATABASE,
      user: process.env.PGUSER,
      password: process.env.PGPASSWORD,
    };

async function main() {
  const client = new Client(db);
  await client.connect();
  console.log("[seed-settings] Connected to DB");

  try {
    await client.query(`
      CREATE SCHEMA IF NOT EXISTS settings;
      CREATE TABLE IF NOT EXISTS settings.coin_universe (
        symbol text PRIMARY KEY,
        enabled boolean NOT NULL DEFAULT true,
        base_asset text,
        quote_asset text,
        metadata jsonb NOT NULL DEFAULT '{}'::jsonb
      );
    `);

    await client.query("BEGIN");

    const insertSQL = `
      INSERT INTO settings.coin_universe(symbol, enabled, base_asset, quote_asset, metadata)
      SELECT s.symbol, true, s.base_asset, s.quote_asset,
             jsonb_build_object('seededAt', now()::text)
      FROM market.symbols s
      WHERE COALESCE(s.status,'TRADING')='TRADING'
      ON CONFLICT (symbol) DO UPDATE
        SET base_asset=EXCLUDED.base_asset,
            quote_asset=EXCLUDED.quote_asset,
            enabled=true,
            metadata=EXCLUDED.metadata;
    `;
    await client.query(insertSQL);

    if (ONLY_USDT) {
      const upd = await client.query(
        "UPDATE settings.coin_universe SET enabled=false WHERE quote_asset <> 'USDT' AND enabled=true"
      );
      console.log(`[seed-settings] Disabled non-USDT: ${upd.rowCount}`);
    }

    await client.query("COMMIT");

    const { rows } = await client.query(
      "SELECT COUNT(*)::int AS cnt FROM settings.coin_universe WHERE enabled=true"
    );
    console.log(`[seed-settings] Done. Enabled rows = ${rows[0].cnt}`);
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("[seed-settings] Error:", err);
  } finally {
    await client.end();
    console.log("[seed-settings] Connection closed.");
  }
}

if (import.meta.url === `file://${process.argv[1]}`) main();
