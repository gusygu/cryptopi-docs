#!/usr/bin/env tsx
import 'dotenv/config';
import { Pool } from 'pg';
import assert from 'node:assert';

const BINANCE = process.env.BINANCE_REST ?? 'https://api.binance.com/api';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function upsertDiscovery(client: any, rows: any[]) {
  const q = `
  insert into ingest.symbol_discovery (source,symbol,base,quote,meta_json)
  values ${rows.map((_,i)=> `('binance',$${i*4+1},$${i*4+2},$${i*4+3},$${i*4+4})`).join(',')}
  on conflict (source, symbol) do update set
    base = excluded.base,
    quote = excluded.quote,
    meta_json = excluded.meta_json,
    discovered_at = now()
  `;
  const vals = rows.flatMap(r => [r.symbol, r.baseAsset, r.quoteAsset, r]);
  await client.query(q, vals);
}

async function syncRegistry(client: any, rows: any[]) {
  const q = `
  insert into market.symbol_registry (source,symbol,base,quote,status,meta_json)
  values ${rows.map((_,i)=> `('binance',$${i*5+1},$${i*5+2},$${i*5+3},'discovered',$${i*5+4})`).join(',')}
  on conflict (source, symbol) do update set
    base = excluded.base,
    quote = excluded.quote,
    meta_json = excluded.meta_json,
    updated_at = now()
  `;
  const vals = rows.flatMap(r => [r.symbol, r.baseAsset, r.quoteAsset, r]);
  await client.query(q, vals);
}

async function main() {
  const [infoRes] = await Promise.all([
    fetch(`${BINANCE}/v3/exchangeInfo`).then(r=>r.json())
  ]);
  assert(infoRes.symbols?.length, 'No symbols from exchangeInfo');

  const tradables = infoRes.symbols.filter((s:any)=> s.status === 'TRADING');
  const client = await pool.connect();
  try {
    await client.query('begin');
    await upsertDiscovery(client, tradables);
    await syncRegistry(client, tradables);
    await client.query('commit');
  } catch (e) {
    await client.query('rollback'); throw e;
  } finally {
    client.release();
  }
  await pool.end();
}

main().catch(err => { console.error(err); process.exit(1); });
