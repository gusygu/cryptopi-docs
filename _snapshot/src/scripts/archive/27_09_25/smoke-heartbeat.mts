// src/scripts/smokes/smoke-heartbeat.mts
// Writer heartbeat into app_ledger: measures write→read RTT and verifies insert/select perms.

import { randomUUID } from 'node:crypto';
import { getClient } from '../../utils/db.mjs';

const cyan = (s:string)=>`\x1b[36m${s}\x1b[0m`;
const green=(s:string)=>`\x1b[32m${s}\x1b[0m`;
const red  =(s:string)=>`\x1b[31m${s}\x1b[0m`;
const yel  =(s:string)=>`\x1b[33m${s}\x1b[0m`;

async function main(){
  const client = await getClient();
  try{
    const ts = Date.now();
    const idem = randomUUID();
    const payload = { smoke: 'heartbeat', ts, idem };

    const writeStart = performance.now();
    await client.query(
      `insert into app_ledger (topic, event, payload, session_id, idempotency_key, ts_epoch_ms)
       values ($1,$2,$3,$4,$5,$6)
       on conflict (idempotency_key) do nothing`,
      ['smoke','heartbeat', payload, process.env.APP_SESSION_ID ?? null, idem, ts]
    );
    const writeEnd = performance.now();

    const readStart = performance.now();
    const { rows } = await client.query(
      `select id, topic, event, payload, ts_epoch_ms
         from app_ledger
        where idempotency_key = $1`, [idem]
    );
    const readEnd = performance.now();

    const found = rows.length === 1;
    const writeMs = +(writeEnd - writeStart).toFixed(2);
    const readMs  = +(readEnd - readStart).toFixed(2);

    console.log(cyan('[heartbeat] app_ledger write→read'));
    console.log(`  write: ${found ? green('OK') : yel('?')} ${writeMs} ms`);
    console.log(`  read : ${found ? green('OK') : red('MISS')} ${readMs} ms`);
    if (!found) {
      console.log(red('✖ Insert not visible on read path (permissions/tx/connection?)'));
      process.exitCode = 1;
    }
  } catch (e:any) {
    console.error(red('[heartbeat error]'), e?.message || e);
    process.exitCode = 1;
  } finally {
    await client.end().catch(()=>{});
  }
}

main();
