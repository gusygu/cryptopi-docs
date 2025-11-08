import { getPool } from "../../../../legacy/pool";

export default async function computeStats() {
  const pool = getPool();
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    await c.query(`
      INSERT INTO str_aux.stats_symbol (run_id, symbol, stat_key, stat_value, computed_at)
      SELECT
        current_setting('app.current_session_id')::uuid,
        v.symbol,
        'count'::text,
        COUNT(*)::numeric,
        now()
      FROM str_aux.vectors_symbol v
      WHERE v.run_id = current_setting('app.current_session_id')::uuid
      GROUP BY v.symbol
      ON CONFLICT (run_id, symbol, stat_key)
      DO UPDATE SET
        stat_value = EXCLUDED.stat_value,
        computed_at = EXCLUDED.computed_at;
    `);
    await c.query("COMMIT");
    console.log("✅ stats computed");
  } catch (e) {
    await c.query("ROLLBACK");
    throw e;
  } finally { c.release(); }
}

if ((import.meta as any).main) computeStats().catch(e => { console.error(e); process.exit(1); });
