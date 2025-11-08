// pnpm tsx src/scripts/smokes/str-aux-persist-auto-smoke.mts
import "dotenv/config";
import { Pool } from "pg";

const CONN =
  process.env.DATABASE_URL ??
  process.env.POSTGRES_URL ??
  process.env.POSTGRES_CONNECTION_STRING;
if (!CONN) {
  console.error("❌ DATABASE_URL (or POSTGRES_URL) is missing.");
  process.exit(1);
}
const pool = new Pool({ connectionString: CONN });

async function tryq<T = any>(db: any, sql: string, params: any[] = []) {
  try { const { rows } = await db.query(sql, params); return rows as T[]; }
  catch (e: any) { console.warn("SQL warn:", e?.message ?? e); return [] as T[]; }
}

async function getUniverse(db: any): Promise<string[]> {
  // 1) settings.coin_universe (enabled)
  let rows = await tryq(db, `
    SELECT DISTINCT symbol::text AS symbol
    FROM settings.coin_universe
    WHERE COALESCE(enabled, true) = true
  `);
  if (rows.length) return rows.map(r => r.symbol);

  // 2) fallback to whatever klines has
  rows = await tryq(db, `SELECT DISTINCT symbol::text AS symbol FROM market.klines`);
  if (rows.length) return rows.map(r => r.symbol);

  // 3) last resort
  return ["ADAUSDT","BTCUSDT","ETHUSDT","SOLUSDT"];
}

async function main() {
  const db = await pool.connect();
  try {
    console.log("=== STR-AUX Persist Auto Smoke ===");

    const perms = await tryq(db, `SELECT * FROM debug.perms`);
    if (perms[0]) console.log("perms:", perms[0]);

    const UNIVERSE = await getUniverse(db);
    console.log("universe:", UNIVERSE);

    // pre-gap
    const gaps0 = await tryq(db, `
      SELECT symbol, win, kline_rows, stats_rows, vector_rows, diagnosis
      FROM debug.straux_gaps
      ORDER BY symbol, win
    `);
    console.table(gaps0.slice(0, 20));

    // known windows from klines (symbol, win)
    const winRows = await tryq(db, `
      SELECT symbol, win
      FROM debug._klines_win
      GROUP BY symbol, win
      ORDER BY symbol, win
    `);
    const windowsBySymbol = new Map<string, string[]>();
    for (const r of winRows) {
      const arr = windowsBySymbol.get(r.symbol) ?? [];
      arr.push(r.win);
      windowsBySymbol.set(r.symbol, arr);
    }

    // recompute for universe × available windows
    for (const symbol of UNIVERSE) {
      const wins = windowsBySymbol.get(symbol) ?? ["1m","3m","5m","15m","1h"];
      for (const w of wins) {
        try {
          const a = await db.query(`SELECT str_aux.recompute_window_stats($1,$2) AS n`, [symbol, w]);
          const b = await db.query(`SELECT str_aux.recompute_window_vectors($1,$2) AS m`, [symbol, w]);
          console.log(`${symbol} ${w}: stats=${a.rows[0]?.n ?? 0} vectors=${b.rows[0]?.m ?? 0}`);
        } catch (e: any) {
          console.warn(`${symbol} ${w}: recompute error ->`, e?.message ?? e);
        }
      }
    }

    // post-gap
    const gaps1 = await tryq(db, `
      SELECT symbol, win, kline_rows, stats_rows, vector_rows, diagnosis
      FROM debug.straux_gaps
      ORDER BY symbol, win
    `);
    console.log("post-recompute:");
    console.table(gaps1.slice(0, 20));

    const latestS = await tryq(db, `SELECT * FROM str_aux.stats_latest  LIMIT 5`);
    const latestV = await tryq(db, `SELECT * FROM str_aux.vectors_latest LIMIT 5`);
    console.log("stats_latest sample:", latestS);
    console.log("vectors_latest sample:", latestV);

    // status
    const missing = gaps1.filter(r => !(r.stats_rows > 0 && r.vector_rows > 0)).length;
    if (missing > 0) {
      console.error(`❌ Missing persistence on ${missing} symbol×window combos`);
      process.exitCode = 1;
    } else {
      console.log("✅ All symbol×window combos persisted.");
    }
  } finally {
    db.release();
    await pool.end();
  }
}

const db = await pool.connect();
const fromSettings = await tryq(db, `
  SELECT 1 FROM information_schema.tables
  WHERE table_schema='settings' AND table_name='coin_universe'
`);
console.log("universe source:", fromSettings.length ? "settings.coin_universe" : "market.klines");


main().catch(e => { console.error(e); process.exit(1); });

