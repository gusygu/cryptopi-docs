/* ts-node scripts/seed.ts
   Loads .env and talks directly to Postgres without importing app code. */
import 'dotenv/config';
import { Pool } from 'pg';

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });

  // 1) ensure there is at least one coin in settings; if not, warn
  const { rows: have } = await pool.query(`select count(*)::int as n from settings_coin_universe`);
  if (!have?.[0]?.n) {
    console.warn('settings_coin_universe is empty — add coins in the Settings page first.');
  }

  // 2) create a session & snapshot coins (same logic as SQL seed)
  const { rows: s } = await pool.query(
    `insert into cin_session(window_label, window_bins, window_ms)
     values ('H1@128',128,3600000) returning session_id`
  );
  const session_id = s[0].session_id;

  await pool.query(
    `insert into session_coin_universe(session_id, symbol)
     select $1, symbol from settings_coin_universe
     on conflict do nothing`, [session_id]
  );

  console.log(JSON.stringify({ session_id }, null, 2));
  await pool.end();
}
main().catch(e => { console.error(e); process.exit(1); });
