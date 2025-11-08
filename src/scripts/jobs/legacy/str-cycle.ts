import { Client } from "pg";

const DB = process.env.DATABASE_URL ? { connectionString: process.env.DATABASE_URL } : {
  host: process.env.PGHOST,
  port: process.env.PGPORT ? Number(process.env.PGPORT) : undefined,
  database: process.env.PGDATABASE,
  user: process.env.PGUSER,
  password: process.env.PGPASSWORD,
};

async function main() {
  const client = new Client(DB as any);
  await client.connect();

  const { rows: syms } = await client.query(
    `SELECT symbol FROM settings.coin_universe WHERE enabled ORDER BY symbol`
  );

  const now = new Date();
  const window_key = "1h";
  const bins = 48;

  await client.query("BEGIN");
  const run = await client.query(
    `INSERT INTO str_aux.vectors_run (run_id, ts, window_key, bins)
     VALUES (gen_random_uuid(), $1, $2, $3)
     RETURNING run_id`,
    [now, window_key, bins]
  );
  const run_id = run.rows[0].run_id;

  for (const { symbol } of syms) {
    await client.query(
      `INSERT INTO str_aux.vectors_symbol(run_id, symbol, v_inner, v_outer, spread, v_tendency, v_swap, summary)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'{}'::jsonb)`,
      [run_id, symbol, 0.1, 0.2, 0.05, 0.01, 0.02]
    );
  }
  await client.query("COMMIT");
  await client.end();
}

main().catch(e => { console.error(e); process.exit(1); });
