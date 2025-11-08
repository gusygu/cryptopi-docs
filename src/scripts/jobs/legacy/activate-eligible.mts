// src/jobs/activate-eligible.mts (excerpt)
import { Pool } from 'pg';
import { firstTouch } from '../lib/firstTouch';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function main() {
  const client = await pool.connect();
  try {
    await client.query('begin');

    await client.query(`
      update market.symbol_registry r
      set status='eligible', updated_at=now(), eligible_reason='SCR/CCR ok'
      from market.active_candidates v
      where r.source=v.source and r.symbol=v.symbol and r.status in ('discovered','error')
    `);

    const { rows } = await client.query(`
      update market.symbol_registry
      set status='active', activated_at=coalesce(activated_at, now()), updated_at=now()
      where status='eligible'
      returning symbol
    `);

    for (const { symbol } of rows) {
      await firstTouch(client, symbol);
    }

    await client.query('commit');
  } catch (e) {
    await client.query('rollback'); throw e;
  } finally {
    client.release(); await pool.end();
  }
}
main().catch(e => { console.error(e); process.exit(1); });
