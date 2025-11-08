import { getPool } from "../../../../legacy/pool";

export default async function computeVectors() {
  const pool = getPool();
  const c = await pool.connect();
  try {
    // one short transaction for the batch
    await c.query("BEGIN");
    await c.query(`
      INSERT INTO str_aux.vectors_symbol (run_id, symbol, v_swap, v_tendency, gfm, computed_at)
      SELECT
        current_setting('app.current_session_id')::uuid AS run_id,
        s.symbol,
        /* placeholder calcs */ AVG(s.price::numeric) AS v_swap,
        STDDEV_POP(s.price::numeric) AS v_tendency,
        COALESCE(AVG(s.volume::numeric),0) AS gfm,
        now()
      FROM str_aux.samples_symbol s
      WHERE s.run_id = current_setting('app.current_session_id')::uuid
      GROUP BY s.symbol
      ON CONFLICT (run_id, symbol)
      DO UPDATE SET
        v_swap = EXCLUDED.v_swap,
        v_tendency = EXCLUDED.v_tendency,
        gfm = EXCLUDED.gfm,
        computed_at = EXCLUDED.computed_at;
    `);
    await c.query("COMMIT");
    console.log("✅ vectors computed");
  } catch (e) {
    await c.query("ROLLBACK");
    throw e;
  } finally { c.release(); }
}

if ((import.meta as any).main) computeVectors().catch(e => { console.error(e); process.exit(1); });
