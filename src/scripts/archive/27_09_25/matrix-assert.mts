// Hard checks:
// - All kinds present at latest benchmark ts with rows == N*(N-1)
// - base, quote ∈ COINS and base != quote
// - meta.src exists on primaries and is NOT 'fallback' (unless ALLOW_FALLBACK=true)
// - derived/ref kinds have expected meta.from and opening_ts when applicable
import { Pool } from "pg";
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const COINS = (process.env.COINS ?? "BTC,ETH,BNB,SOL,ADA,XRP,DOGE,USDT")
  .split(",").map(s => s.trim().toUpperCase()).filter(Boolean);
const KINDS = ["benchmark","delta","pct24h","id_pct","pct_drv","pct_ref","ref"];
const EXPECTED = COINS.length * (COINS.length - 1);
const ALLOW_FALLBACK = (process.env.ALLOW_FALLBACK ?? "false").toLowerCase() === "true";

async function latestBenchmarkTs(): Promise<number|null> {
  const { rows } = await pool.query(`SELECT MAX(ts_ms) AS ts FROM dyn_matrix_values WHERE matrix_type='benchmark'`);
  return rows?.[0]?.ts ? Number(rows[0].ts) : null;
}

async function count(kind:string, ts:number) {
  const { rows } = await pool.query(
    `SELECT COUNT(*)::int AS c FROM dyn_matrix_values WHERE matrix_type=$1 AND ts_ms=$2`, [kind, ts]
  );
  return Number(rows?.[0]?.c ?? 0);
}

async function fetchRows(kind:string, ts:number) {
  const { rows } = await pool.query(
    `SELECT base,quote,value,meta FROM dyn_matrix_values WHERE matrix_type=$1 AND ts_ms=$2`, [kind, ts]
  );
  return rows as {base:string,quote:string,value:number,meta:any}[];
}

function assert(cond:boolean, msg:string) {
  if (!cond) { console.error("ASSERT:", msg); process.exit(1); }
}

(async () => {
  try {
    const ts = await latestBenchmarkTs();
    assert(!!ts, "no benchmark ts in DB");
    for (const k of KINDS) {
      const c = await count(k, ts!);
      assert(c === EXPECTED, `${k}: expected ${EXPECTED} rows, got ${c} @ts=${ts}`);
      const rows = await fetchRows(k, ts!);
      for (const r of rows) {
        assert(COINS.includes(r.base), `${k}: base not in COINS -> ${r.base}`);
        assert(COINS.includes(r.quote), `${k}: quote not in COINS -> ${r.quote}`);
        assert(r.base !== r.quote, `${k}: diagonal row persisted for ${r.base}/${r.quote}`);
        if (["benchmark","delta","pct24h"].includes(k)) {
          const src = r.meta?.src ?? "";
          assert(!!src, `${k}: missing meta.src`);
          if (!ALLOW_FALLBACK) assert(!/^fallback$/i.test(src), `${k}: meta.src is fallback`);
        }
        if (k === "id_pct")   assert(r.meta?.from === "derived", `${k}: meta.from must be 'derived'`);
        if (k === "pct_drv")  assert(r.meta?.from === "derived", `${k}: meta.from must be 'derived'`);
        if (k === "pct_ref")  assert(r.meta?.from === "ref",     `${k}: meta.from must be 'ref'`);
        if (k === "ref")      assert(r.meta?.from === "ref",     `${k}: meta.from must be 'ref'`);
        if (["pct_ref","ref"].includes(k)) {
          assert(Number.isFinite(Number(r.meta?.opening_ts ?? NaN)), `${k}: missing numeric opening_ts in meta`);
        }
      }
    }
    console.log(`[matrix-assert] OK @ts=${ts} rows=${EXPECTED}×${KINDS.length}`);
  } catch (e) {
    console.error("[matrix-assert] error", e);
    process.exit(1);
  } finally {
    await pool.end();
  }
})();
