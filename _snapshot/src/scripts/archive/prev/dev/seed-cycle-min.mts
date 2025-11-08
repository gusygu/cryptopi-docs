// src/scripts/dev/seed-cycle-min.mts
import 'dotenv/config';
import pkg from 'pg';
const { Pool } = pkg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const appSession = process.env.APP_SESSION_ID ?? 'dev-01';
const cycleTs = Date.now();
const symbols = (process.env.SEED_SYMBOLS ?? 'BTC,ETH,USDT').split(',');

async function main() {
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    await c.query(`insert into app_sessions(app_session_id) values ($1) on conflict do nothing`, [appSession]);
    for (const s of symbols) {
      await c.query(`insert into coins(symbol) values ($1) on conflict do nothing`, [s]);
    }
    await c.query(`insert into cycles(cycle_ts) values ($1) on conflict do nothing`, [cycleTs]);

    // minimal MEA (id_pct)
    for (const base of ['BTC']) {
      for (const quote of ['ETH']) {
        await c.query(
          `insert into mea_orientations (cycle_ts, base, quote, metric, value)
           values ($1,$2,$3,'id_pct',$4)
           on conflict (cycle_ts, base, quote, metric) do update set value=excluded.value`,
          [cycleTs, base, quote, 0.001]
        );
      }
    }

    // minimal CIN (wallet/profit)
    for (const s of ['BTC','ETH']) {
      await c.query(
        `insert into cin_aux_cycle (app_session_id, cycle_ts, symbol, wallet_usdt, profit_usdt, imprint_cycle_usdt, luggage_cycle_usdt)
         values ($1,$2,$3,100,0,0,0)
         on conflict (app_session_id, cycle_ts, symbol) do update
           set wallet_usdt=excluded.wallet_usdt`,
        [appSession, cycleTs, s]
      );
    }

    await c.query('COMMIT');
    console.log(`[seed] cycle=${cycleTs} MEA/CIN inserted.`);
  } catch (e) {
    await c.query('ROLLBACK');
    console.error('[seed] error:', e.message);
    process.exit(1);
  } finally {
    c.release();
    await pool.end();
  }
}

main();
