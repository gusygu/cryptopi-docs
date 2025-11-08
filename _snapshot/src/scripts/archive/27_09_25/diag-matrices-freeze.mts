// src/scripts/smokes/diag-matrices-freeze.mts
// Goal: detect "frozen writes" across matrices by checking ts_ms movement and value variance

// 🔧 removed: import 'dotenv/config';
// 🔧 removed: import fetch from 'node-fetch';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import { getClient } from '@/scripts/utils/db.mts';

type Row = {
  matrix_type: string;
  base: string | null;
  quote: string | null;
  ts_ms: string | number;
  value: number | null;
  app_session_id?: string | null;
};

const argv = yargs(hideBin(process.argv))
  .option('schema', { type: 'string', default: process.env.DB_SCHEMA || 'public' })
  .option('table',  { type: 'string', default: 'dyn_matrix_values' })
  .option('limit',  { type: 'number', default: 100 })
  .option('baseUrl',{ type: 'string', default: process.env.BASE_URL || 'http://localhost:3000' })
  .parseSync();

const cyan = (s:string)=>`\x1b[36m${s}\x1b[0m`;
const green=(s:string)=>`\x1b[32m${s}\x1b[0m`;
const red  =(s:string)=>`\x1b[31m${s}\x1b[0m`;
const yel  =(s:string)=>`\x1b[33m${s}\x1b[0m`;

function pct(n:number, d:number){ return d===0?0: +(100*n/d).toFixed(2) }

async function checkApi(baseUrl:string){
  const paths = [
    '/api/vitals/health',
    '/api/vitals/status',
    '/api/matrices/benchmark',
    '/api/matrices/ref',
  ];
  const results: Record<string, {ok:boolean; status:number; note?:string}> = {};
  for(const p of paths){
    try{
      const r = await fetch(baseUrl + p, { method:'GET' });
      results[p] = { ok: r.ok, status: r.status };
    }catch(err:any){
      results[p] = { ok:false, status:0, note: String(err?.message || err) };
    }
  }
  return results;
}

async function main(){
  const { schema, table, limit, baseUrl } = argv;
  console.log(cyan(`[smoke] freeze diag — schema=${schema} table=${table} limit=${limit}`));

  // 1) API sanity
  const api = await checkApi(baseUrl);
  const apiOk = Object.values(api).every(x=>x.ok);
  console.log(apiOk ? green('✔ APIs reachable') : yel('! Some APIs failed'));
  for (const [p, r] of Object.entries(api)) {
    console.log(`  ${p} => ${r.ok ? 'OK' : 'FAIL'} (${r.status}${r.note?` | ${r.note}`:''})`);
  }

  // 2) DB checks
  const client = await getClient();
  try{
    const qCount = `select count(*)::int as c from ${schema}.${table};`;
    const qHead = `
      select matrix_type, base, quote, ts_ms, value, app_session_id
      from ${schema}.${table}
      order by ts_ms desc
      limit $1;
    `;
    const qGroup = `
      with last_ts as (select max(ts_ms) as ts from ${schema}.${table})
      select m.matrix_type, m.base, m.quote,
             count(*)::int as n_rows,
             min(ts_ms) as ts_min, max(ts_ms) as ts_max,
             (max(ts_ms)-min(ts_ms)) as span_ms,
             stddev_pop(value)::float as std_value
      from ${schema}.${table} m
      join last_ts on true
      where m.ts_ms >= last_ts.ts - 60*60*1000
      group by 1,2,3
      order by span_ms asc nulls last, std_value asc nulls last
      limit 50;
    `;

    const { rows: cnt } = await client.query(qCount);
    console.log(cyan(`DB rows total: ${cnt?.[0]?.c ?? 0}`));

    const { rows: head } = await client.query(qHead, [limit]) as { rows: Row[] };
    const uniques = new Set(head.map(r => `${r.matrix_type}:${r.base}/${r.quote}`));
    console.log(cyan(`Recent unique triples: ${uniques.size} (from ${head.length} rows)`));

    const sameTs = head.length > 0 && head.every(r => String(r.ts_ms) === String(head[0].ts_ms));
    const allSameVal = head.length > 0 && head.every(r => r.value === head[0].value);
    if (sameTs && allSameVal) {
      console.log(red('✖ Strong freeze: identical ts_ms AND identical value across recent rows.'));
    } else if (sameTs) {
      console.log(yel('! Suspected freeze: identical ts_ms across recent rows.'));
    } else {
      console.log(green('✔ ts_ms varies across recent rows.'));
    }

    const { rows: groups } = await client.query(qGroup);
    const zeroSpan = groups.filter((g:any) => Number(g.span_ms) === 0);
    const zeroStd  = groups.filter((g:any) => (g.std_value ?? 0) === 0);

    console.log(cyan(`Groups last hour: ${groups.length}, zero-span: ${zeroSpan.length} (${pct(zeroSpan.length, groups.length)}%), zero-std: ${zeroStd.length} (${pct(zeroStd.length, groups.length)}%)`));

    if (zeroSpan.length > 0 || zeroStd.length > 0) {
      console.log(yel('! Potential partial freeze in some triples (no time advance and/or no value variance).'));
      for (const g of zeroSpan.slice(0,10)) console.log(`  span=0 => ${g.matrix_type}:${g.base}/${g.quote}`);
      for (const g of zeroStd.slice(0,10))  console.log(`  std=0  => ${g.matrix_type}:${g.base}/${g.quote}`);
    } else {
      console.log(green('✔ No freeze signals in grouped last-hour sample.'));
    }
  } finally {
    await client.end().catch(()=>{});
  }
}

main().catch(err=>{
  console.error(red('✖ Smoke failed:'), err);
  process.exitCode = 1;
});
