// Prints the coins header (from env) and verifies that for the latest ts of each kind:
// - bases/quotes ⊆ COINS (and not empty)
// - total rows == N*(N-1)
// - shows distinct meta.src (for benchmark)
import { Pool } from "pg";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const COINS = (process.env.COINS ?? "BTC,ETH,BNB,SOL,ADA,XRP,DOGE,USDT")
  .split(",").map(s => s.trim().toUpperCase()).filter(Boolean);
const KINDS = ["benchmark","delta","pct24h","id_pct","pct_drv","pct_ref","ref"];
const N = COINS.length;
const EXPECTED = N * (N - 1);

const pad = (s:string,w:number)=> (s+" ".repeat(w)).slice(0,w);

async function latestTs(kind:string): Promise<number|null> {
  const { rows } = await pool.query(
    `SELECT MAX(ts_ms) AS ts FROM dyn_matrix_values WHERE matrix_type=$1`, [kind]
  );
  return rows?.[0]?.ts ? Number(rows[0].ts) : null;
}

async function statsAt(kind:string, ts:number) {
  const { rows } = await pool.query(
    `SELECT base,quote,COUNT(*) OVER() AS total, meta->>'src' AS src
       FROM dyn_matrix_values WHERE matrix_type=$1 AND ts_ms=$2`,
    [kind, ts]
  );
  const total = rows?.[0]?.total ? Number(rows[0].total) : 0;
  const bases = new Set<string>(), quotes = new Set<string>(), srcs = new Set<string>();
  for (const r of rows) {
    bases.add(r.base); quotes.add(r.quote);
    if (r.src) srcs.add(r.src);
  }
  return { total, bases: [...bases], quotes: [...quotes], srcs: [...srcs] };
}

(async () => {
  try {
    console.log("[mat-headers] COINS =", COINS.join(","));
    console.log("kind        ts             rows  bases  quotes  complete  src(meta)");
    for (const k of KINDS) {
      const ts = await latestTs(k);
      if (!ts) { console.log(pad(k,12), pad("—",14), pad("0",6), pad("0",6), pad("0",7), "—  —"); continue; }
      const { total, bases, quotes, srcs } = await statsAt(k, ts);
      const inBases = bases.every(b => COINS.includes(b));
      const inQuotes= quotes.every(q => COINS.includes(q));
      const complete = (total === EXPECTED) && inBases && inQuotes && bases.length>0 && quotes.length>0;
      const srcOut = (k === "benchmark") ? (srcs.join(",") || "—") : "—";
      console.log(
        pad(k,12),
        pad(String(ts),14),
        pad(String(total),6),
        pad(String(bases.length),6),
        pad(String(quotes.length),7),
        pad(complete ? "OK" : "NO",9),
        srcOut
      );
    }
  } catch (e) {
    console.error("[mat-headers] error", e);
    process.exit(1);
  } finally {
    await pool.end();
  }
})();
