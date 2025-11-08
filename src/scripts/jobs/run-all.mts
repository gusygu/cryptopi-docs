import { getPool } from "../../../legacy/pool";

export default async function seedAll() {
  const pool = getPool();
  const c = await pool.connect();
  try {
    await c.query("BEGIN");

    await c.query(`
      INSERT INTO settings.runtime (id, coin_universe, default_interval, provider)
      VALUES (1, '{"BTCUSDT","ETHUSDT"}', '1m', 'binance')
      ON CONFLICT (id) DO UPDATE
      SET coin_universe = EXCLUDED.coin_universe,
          default_interval = EXCLUDED.default_interval,
          provider = EXCLUDED.provider;
    `);

    await c.query(`
      INSERT INTO market.symbol (base, quote, tick_size)
      VALUES ('BTC','USDT','0.01'),
             ('ETH','USDT','0.01')
      ON CONFLICT (base,quote) DO NOTHING;
    `);

    await c.query(`
      INSERT INTO ops.session_log (id, label, created_at)
      VALUES (gen_random_uuid(), 'bootstrap', now())
      ON CONFLICT DO NOTHING;
    `);

    await c.query("COMMIT");
    console.log("✅ seed completed");
  } catch (e) {
    await c.query("ROLLBACK");
    console.error(e);
  } finally {
    c.release();
  }
}

if ((import.meta as any).main) seedAll();
