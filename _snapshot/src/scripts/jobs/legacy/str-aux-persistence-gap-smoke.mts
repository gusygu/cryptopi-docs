import { Pool } from "pg";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const SYMBOLS = process.env.COIN_UNIVERSE?.split(",").map(s => s.trim()).filter(Boolean)
  ?? ["BTC/USDT","ETH/USDT","SOL/USDT","ADA/USDT"]; // extend if you want
const WINDOWS = ["1m","3m","5m","15m","1h"];

const q = (s: string) => s.trim();

async function main() {
  const client = await pool.connect();
  try {
    console.log("=== STR-AUX Persistence Gap Smoke ===");

    // 0) basic perms
    const { rows: perms } = await client.query(q(`
      SELECT * FROM debug.perms
    `));
    console.log("perms:", perms[0]);

    // 1) enumerate source vs persisted
    const { rows: gaps } = await client.query(q(`
      SELECT * FROM debug.straux_gaps
      ORDER BY symbol, window
    `));
    console.table(gaps);

    // 2) if we see gaps, try a targeted recompute per symbol/window and show effects
    for (const symbol of SYMBOLS) {
      for (const window of WINDOWS) {
        try {
          const r1 = await client.query(`SELECT str_aux.recompute_window_stats($1,$2) AS n`, [symbol, window]);
          const r2 = await client.query(`SELECT str_aux.recompute_window_vectors($1,$2) AS m`, [symbol, window]);
          console.log(`${symbol} ${window}: recompute stats=${r1.rows[0].n} vectors=${r2.rows[0].m}`);
        } catch (e: any) {
          console.warn(`${symbol} ${window}: recompute error ->`, e?.message ?? e);
        }
      }
    }

    // 3) re-check deltas
    const { rows: gaps2 } = await client.query(q(`
      SELECT * FROM debug.straux_gaps
      ORDER BY symbol, window
    `));
    console.log("post-recompute:");
    console.table(gaps2);

    // 4) common root-cause hints (window mismatch, missing symbol_id mapping, constraint mismatch)
    const { rows: win } = await client.query(q(`
      SELECT * FROM debug.windows_by_symbol ORDER BY symbol, window
    `));
    console.log("windows_by_symbol:", win);

    const { rows: uniq } = await client.query(q(`
      SELECT * FROM debug.unique_targets ORDER BY table_name, index_name
    `));
    console.log("unique_targets:", uniq);

  } finally {
    client.release();
    await pool.end();
  }
}

main().catch(e => { console.error(e); process.exit(1); });
