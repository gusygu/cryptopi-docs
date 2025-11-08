// Shows, at the latest ts per kind, how many rows came from each meta.src
import { Pool } from "pg";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const KINDS = ["benchmark","delta","pct24h","id_pct","pct_drv","ref","pct_ref"];

async function latestTs(kind:string): Promise<number|null> {
  const { rows } = await pool.query(`SELECT MAX(ts_ms) AS ts FROM dyn_matrix_values WHERE matrix_type=$1`, [kind]);
  return rows?.[0]?.ts ? Number(rows[0].ts) : null;
}

(async () => {
  try {
    for (const k of KINDS) {
      const ts = await latestTs(k);
      if (!ts) { console.log(`${k.padEnd(8)} ts=null`); continue; }
      const { rows } = await pool.query(
        `SELECT COALESCE(meta->>'src','(null)') AS src, COUNT(*)::int AS cnt
           FROM dyn_matrix_values
          WHERE matrix_type=$1 AND ts_ms=$2
          GROUP BY 1
          ORDER BY 1`,
        [k, ts]
      );
      const detail = rows.map(r => `${r.src}:${r.cnt}`).join(", ");
      console.log(`${k.padEnd(8)} ts=${ts}  ${detail}`);
    }
  } catch (e) {
    console.error("[matrix-src-check] error", e);
    process.exit(1);
  } finally {
    await pool.end();
  }
})();
