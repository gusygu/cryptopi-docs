// src/scripts/smokes/doctor-remedy.mts
// Minimal orchestrator: seed matrices if empty; ensure STR session is refreshed.
// Dry-run by default. Use --apply to actually execute.
// Requires: smoke:scs:write-trace, job:straux:seed, job:str:refresh pnpm scripts.

import { exec as _exec } from 'node:child_process';
import { promisify } from 'node:util';
import { Client } from 'pg';

const exec = promisify(_exec);
const argv = Object.fromEntries(
  process.argv.slice(2).map(a => a.startsWith('--') ? a.slice(2).split('=') : [a, 'true'])
);
const APPLY = argv.apply === 'true' || argv.apply === '' || argv.apply === '1';

const DATABASE_URL = process.env.DATABASE_URL!;
const APP_SESSION  = process.env.APP_SESSION_ID || 'dev-01';

if (!DATABASE_URL) { console.error('[remedy] Missing DATABASE_URL'); process.exit(2); }

function logStep(s:string){ console.log('\x1b[36m[remedy]\x1b[0m ' + s); }

async function count(client: Client, sql: string) {
  const { rows } = await client.query(sql);
  return Number(rows?.[0]?.c ?? 0);
}

async function main(){
  logStep(`session=${APP_SESSION} apply=${APPLY ? 'YES' : 'no'}`);

  const client = new Client({ connectionString: DATABASE_URL, application_name:'doctor-remedy' });
  await client.connect();

  // 1) MATRICES: seed a tiny grid if empty
  const mCount = await count(client, `select count(*)::int as c from public.dyn_matrix_values`);
  if (mCount === 0) {
    logStep('Matrices appear empty -> seed 2× benchmark rows (BTC/ETH vs USDT).');
    const seedCmd = `pnpm smoke:scs:write-trace -- --bases=BTC,ETH --quote=USDT --type=benchmark`;
    console.log('   • ' + seedCmd);
    if (APPLY) await exec(seedCmd);
  } else {
    logStep(`Matrices rows present: ${mCount} (skip seed)`);
  }

  // 2) STRAUX: ensure snapshots exist; then refresh session
  const snapCount = await count(client, `select count(*)::int as c from public.strategy_aux_snapshots`);
  if (snapCount === 0) {
    logStep('STR snapshots empty -> seed from bins.');
    console.log('   • pnpm run job:straux:seed');
    if (APPLY) await exec('pnpm run job:straux:seed', {
      env: { ...process.env, APP_SESSION_ID: APP_SESSION }
    });
  } else {
    logStep(`STR snapshots present: ${snapCount}`);
  }

  const sessCount = await count(client, `select count(*)::int as c from strategy_aux.str_aux_session`);
  if (sessCount === 0) {
    logStep('STR session empty -> run session refresher.');
    console.log('   • pnpm run job:str:refresh');
    if (APPLY) await exec('pnpm run job:str:refresh', {
      env: { ...process.env, APP_SESSION_ID: APP_SESSION }
    });
  } else {
    logStep(`STR session rows: ${sessCount}`);
  }

  // 3) Quick report on CIN/MEA (no writes)
  const cinCount = await count(client, `select count(*)::int as c from public.v_cin_aux`);
  const meaCount = await count(client, `select count(*)::int as c from public.mea_orientations`);
  logStep(`CIN view rows (v_cin_aux): ${cinCount}`);
  logStep(`MEA rows (mea_orientations): ${meaCount}`);
  if (cinCount === 0) console.log('   • hint: start CIN writer or verify upstream base tables feeding the view.');
  if (meaCount === 0) console.log('   • hint: run MEA refresh/backfill job if available.');

  await client.end();
  logStep('Done.');
}

main().catch(e => { console.error('[remedy error]', e?.message || e); process.exit(1); });
