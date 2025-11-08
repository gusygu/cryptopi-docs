// quick per-kind count at the latest timestamp for that kind
import { Pool } from "pg";

const KINDS = [
  "benchmark","delta","pct24h",
  "id_pct","pct_drv","ref","pct_ref",
];

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });

  for (const k of KINDS) {
    const { rows: tsRow } = await pool.query(
      `SELECT MAX(ts_ms) AS ts FROM dyn_matrix_values WHERE matrix_type=$1`, [k]
    );
    const ts = tsRow?.[0]?.ts ? Number(tsRow[0].ts) : null;
    if (!ts) {
      console.log(`${k.padEnd(8)}  ts=null  count=0`);
      continue;
    }
    const { rows } = await pool.query(
      `SELECT COUNT(*)::int AS c FROM dyn_matrix_values WHERE matrix_type=$1 AND ts_ms=$2`, [k, ts]
    );
    const cnt = rows?.[0]?.c ?? 0;
    console.log(`${k.padEnd(8)}  ts=${ts}  count=${cnt}`);
  }

  await pool.end();
}

main().catch(e => { console.error(e); process.exit(1); });
