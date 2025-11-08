// prints the latest ts per matrix kind (zeros are valid)
import { Pool } from "pg";

const COINS = (process.env.COINS ?? "BTC,ETH,BNB,SOL,ADA,XRP,DOGE,USDT")
  .split(",").map(s => s.trim().toUpperCase()).filter(Boolean);

const KINDS = [
  "benchmark","delta","pct24h",
  "id_pct","pct_drv",
  "ref","pct_ref",          // ← include both new kinds
];

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const ts: Record<string, number | null> = {};

  for (const k of KINDS) {
    // IMPORTANT: do not filter zeros; just take the max ts_ms for the kind
    const { rows } = await pool.query(
      `SELECT MAX(ts_ms) AS ts FROM dyn_matrix_values WHERE matrix_type = $1`,
      [k]
    );
    const v = rows?.[0]?.ts;
    ts[k] = (v == null) ? null : Number(v);
  }

  const out = {
    ts: {
      benchmark: ts["benchmark"],
      delta    : ts["delta"],
      pct24h   : ts["pct24h"],
      id_pct   : ts["id_pct"],
      pct_drv  : ts["pct_drv"],
      ref      : ts["ref"],
      pct_ref  : ts["pct_ref"],
    },
    coins: COINS,
    kinds: KINDS,
  };

  console.log(JSON.stringify(out, null, 2));
  await pool.end();
}

main().catch(e => { console.error(e); process.exit(1); });
