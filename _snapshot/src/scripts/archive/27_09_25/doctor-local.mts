// Storage-only doctor: SRC_TS & SNAP_TS from DB, no HTTP.
// SNAP_TS = latest benchmark ts if ALL 7 kinds have full grid at that ts.
import { Pool } from "pg";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const COINS = (process.env.COINS ?? "BTC,ETH,BNB,SOL,ADA,XRP,DOGE,USDT")
  .split(",").map(s => s.trim().toUpperCase()).filter(Boolean);
const KINDS = ["benchmark","delta","pct24h","id_pct","pct_drv","pct_ref","ref"]; // 7 kinds
const EXPECTED_CELLS = COINS.length * (COINS.length - 1); // off-diagonal cells

const now = () => Date.now();
const fmtAge = (ms:number|null) => ms==null ? "—"
  : ms < 60_000 ? `${Math.round(ms/1000)}s`
  : `${Math.floor(ms/60000)}m ${Math.round((ms%60000)/1000)}s`;
const pad = (s:string, w:number) => (s + " ".repeat(w)).slice(0, w);
const num = (n:number|null) => n==null ? "—" : String(n);

async function latestBenchmarkTs(): Promise<number|null> {
  const { rows } = await pool.query(
    `SELECT MAX(ts_ms) AS ts FROM dyn_matrix_values WHERE matrix_type='benchmark'`
  );
  return rows?.[0]?.ts ? Number(rows[0].ts) : null;
}

async function countAt(kind:string, ts:number): Promise<number> {
  const { rows } = await pool.query(
    `SELECT COUNT(*)::int AS c FROM dyn_matrix_values WHERE matrix_type=$1 AND ts_ms=$2`,
    [kind, ts]
  );
  return Number(rows?.[0]?.c ?? 0);
}

async function hasCompleteGridAt(ts:number): Promise<boolean> {
  // All 7 kinds must have >= EXPECTED_CELLS rows at the same ts.
  const counts = await Promise.all(KINDS.map(k => countAt(k, ts)));
  return counts.every(c => c >= EXPECTED_CELLS);
}

async function distinctSrcAt(ts:number|null): Promise<string[]> {
  if (!ts) return [];
  const { rows } = await pool.query(
    `SELECT DISTINCT meta->>'src' AS src
       FROM dyn_matrix_values
      WHERE matrix_type='benchmark' AND ts_ms=$1`,
    [ts]
  );
  return (rows ?? []).map(r => r.src).filter(Boolean);
}

(async function main() {
  try {
    const tDoc = now();
    const tsDB = await latestBenchmarkTs();  // storage anchor
    const snapOk = tsDB ? await hasCompleteGridAt(tsDB) : false;
    const tsSN = snapOk ? tsDB : null;

    const srcs = await distinctSrcAt(tsDB);
    const srcTS = srcs.length ? tsDB : null;

    const staleSrc = srcTS ? tDoc - srcTS : null;
    const staleMid = tsDB ? tDoc - tsDB : null;
    const verdict = tsSN ? "OK" : (tsDB ? "Partial grid" : "No data");

    console.log(`[doctor:local] schema=${process.env.PGSCHEMA ?? "public"} app_session=${process.env.APP_SESSION_ID ?? "—"}`);
    console.log("");
    console.log("DOMAIN    SRC_TS          SNAP_TS         SESS/DB_TSDOC_TS  STALE(src)  STALE(mid/db)  VERDICT");
    console.log(
      pad("MATRICES",10),
      pad(num(srcTS),15),
      pad(num(tsSN),15),
      pad(num(tsDB),16),
      pad(fmtAge(staleSrc),11),
      pad(fmtAge(staleMid),14),
      verdict
    );
    console.log("");
    console.log(`notes: grid=${COINS.length}×${COINS.length} cells=${EXPECTED_CELLS} kinds=${KINDS.length} src(meta)= ${srcs.join(",") || "—"}`);
  } catch (e) {
    console.error("[doctor:local] error", e);
    process.exit(1);
  } finally {
    await pool.end();
  }
})();
