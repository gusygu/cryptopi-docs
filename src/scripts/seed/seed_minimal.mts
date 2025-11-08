import type { Client } from "pg";

export async function runSeed(client: Client) {
  await client.query("BEGIN");

  // --- Universe
  await client.query(`
    INSERT INTO settings.coin_universe(symbol, base_asset, quote_asset, enabled, metadata)
    VALUES
      ('BTCUSDT','BTC','USDT',true,'{}'),
      ('ETHUSDT','ETH','USDT',true,'{}')
    ON CONFLICT (symbol) DO UPDATE SET
      base_asset = EXCLUDED.base_asset,
      quote_asset = EXCLUDED.quote_asset,
      enabled = EXCLUDED.enabled
  `);

  // --- Wallet sync & demo balances
  await client.query(`SELECT market.sync_wallet_assets_from_universe_helper();`);
  await client.query(`SELECT market.upsert_wallet_balance('USDT', 1000, 0, '{}')`);
  await client.query(`SELECT market.upsert_wallet_balance('BTC' , 0.05 , 0, '{}')`);

  // --- STR seeds (vectors/stats/samples)
  const run1 = await client.query(
    `INSERT INTO str_aux.vectors_run (run_id, ts, window_key, bins)
     VALUES (gen_random_uuid(), now(), '1h', 48) RETURNING run_id`
  );
  for (const sym of ["BTCUSDT", "ETHUSDT"]) {
    await client.query(
      `INSERT INTO str_aux.vectors_symbol(run_id, symbol, v_inner, v_outer, spread, v_tendency, v_swap, summary)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'{}'::jsonb)`,
      [run1.rows[0].run_id, sym, 0.1, 0.2, 0.05, 0.01, 0.02]
    );
  }

  const run2 = await client.query(
    `INSERT INTO str_aux.stats_run (run_id, ts, window_key, bins)
     VALUES (gen_random_uuid(), now(), '1h', 48) RETURNING run_id`
  );
  for (const sym of ["BTCUSDT", "ETHUSDT"]) {
    await client.query(
      `INSERT INTO str_aux.stats_symbol(run_id, symbol, ok, n_points, stats, metrics)
       VALUES ($1,$2,true,100,'{}'::jsonb,'{}'::jsonb)`,
      [run2.rows[0].run_id, sym]
    );
  }

  const run3 = await client.query(
    `INSERT INTO str_aux.samples_run (run_id, ts)
     VALUES (gen_random_uuid(), now()) RETURNING run_id`
  );
  for (const sym of ["BTCUSDT", "ETHUSDT"]) {
    await client.query(
      `INSERT INTO str_aux.samples_symbol(run_id, symbol, ok, cycle, windows, last_point, last_closed_mark, history_size)
       VALUES ($1,$2,true,0,'[]'::jsonb,'{}'::jsonb,true,0)`,
      [run3.rows[0].run_id, sym]
    );
  }

  // --- Minimal matrices
  const reg = await client.query(
    `INSERT INTO cin_aux.mat_registry(mat_id, session_id, name, window_label, bins)
     VALUES (gen_random_uuid(), gen_random_uuid(), 'id_pct', '1h', 48)
     RETURNING mat_id`
  );
  const mid = reg.rows[0].mat_id;
  await client.query(
    `INSERT INTO cin_aux.mat_cell(mat_id, i, j, v) VALUES
       ($1,1,1,0.0),($1,1,2,0.1),($1,2,1,-0.1),($1,2,2,0.0)`,
    [mid]
  );

  await client.query("COMMIT");
}
