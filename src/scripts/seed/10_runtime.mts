import { getPool } from "../../../legacy/pool";

export default async function seedRuntime() {
  const pool = getPool();
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    // settings.runtime: adjust table/columns if yours differ
    await c.query(`
      INSERT INTO settings.runtime (id, provider, default_interval, coin_universe)
      VALUES (1, 'binance', '1m', string_to_array($1, ','))
      ON CONFLICT (id) DO UPDATE
      SET provider = EXCLUDED.provider,
          default_interval = EXCLUDED.default_interval,
          coin_universe = EXCLUDED.coin_universe;
    `, [process.env.SYMBOLS ?? "BTCUSDT,ETHUSDT"]);
    await c.query("COMMIT");
    console.log("✅ runtime seeded");
  } catch (e) {
    await c.query("ROLLBACK");
    throw e;
  } finally { c.release(); }
}
