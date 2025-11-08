// src/scripts/smokes/smoke-poller-4dom.mts
// 3-pulse DB reads across 4 domains, with robust SQL fallbacks and staleness
// Usage:
//   pnpm smoke:diag:poller
//   node --import tsx --env-file=.env src/scripts/smokes/smoke-poller-4dom.mts --intervalMs=12000 --limit=16

// Try importing helper; if it fails (path/extension), inline a fallback
let getClient: ()=>Promise<any>;
try {
  // @ts-ignore
  ({ getClient } = await import('../../utils/db.mjs'));
} catch {
  const { Client } = await import('pg');
  getClient = async () => {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) throw new Error('Missing env: DATABASE_URL');
    const client = new Client({ connectionString, statement_timeout: 30000, application_name: 'smoke-poller-4dom' });
    await client.connect();
    return client;
  };
}

const argv = (() => {
  const out: Record<string, string> = {};
  for (let i = 2; i < process.argv.length; i++) {
    const a = process.argv[i];
    if (a.startsWith('--')) {
      const [k, v] = a.slice(2).split('=');
      out[k] = v ?? 'true';
    }
  }
  return out;
})();

const schema = process.env.DB_SCHEMA || 'public';
const strategySchema = argv['strategy.schema'] || 'strategy_aux';
const repeats    = Number(argv.repeats ?? 3);
const intervalMs = Number(argv.intervalMs ?? 15000);
const tolerance  = Number(argv.tolerance ?? 5000);
const limit      = Number(argv.limit ?? 12);

const cyan = (s:string)=>`\x1b[36m${s}\x1b[0m`;
const green=(s:string)=>`\x1b[32m${s}\x1b[0m`;
const red  =(s:string)=>`\x1b[31m${s}\x1b[0m`;
const yel  =(s:string)=>`\x1b[33m${s}\x1b[0m`;
const bold =(s:string)=>`\x1b[1m${s}\x1b[0m`;

const sleep = (ms:number)=> new Promise(r=>setTimeout(r, ms));
const nowMs = () => Date.now();

type Row = {
  ts_ms: number | string;
  value?: number | null;
  matrix_type?: string | null;
  base?: string | null;
  quote?: string | null;
  metric?: string | null;
  app_session_id?: string | null;
};
type Pull = { tsMax:number|null; tsMin:number|null; values:number[]; rows:Row[]; staleMs:number|null; usedIx:number|null };

function toNum(x:any): number | null {
  if (x === null || x === undefined) return null;
  const n = typeof x === 'string' ? Number(x) : x;
  return Number.isFinite(n) ? Number(n) : null;
}
function variance(xs:number[]): number {
  if (xs.length < 2) return 0;
  const m = xs.reduce((a,b)=>a+b,0)/xs.length;
  return xs.reduce((a,b)=>a+(b-m)*(b-m),0)/xs.length;
}
function fmtMs(ms:number|null){
  if (ms==null) return '—';
  const s = Math.floor(ms/1000)%60;
  const m = Math.floor(ms/60000)%60;
  const h = Math.floor(ms/3600000);
  if (h>0) return `${h}h ${m}m ${s}s`;
  if (m>0) return `${m}m ${s}s`;
  return `${s}s`;
}

// Robust: try each SQL; if it throws (missing relation, etc.), skip to next.
async function trySql(client:any, sql:string, limit:number): Promise<Row[]|null> {
  try {
    const { rows } = await client.query(sql, [limit]) as { rows: Row[] };
    return rows;
  } catch {
    return null;
  }
}

async function pull(client:any, sqls:string[], limit:number): Promise<Pull> {
  let usedIx: number | null = null;
  let rows: Row[] = [];
  for (let i=0;i<sqls.length;i++){
    const res = await trySql(client, sqls[i], limit);
    if (Array.isArray(res) && res.length >= 0) { // accept empty; we just want a non-throwing source
      rows = res;
      usedIx = i;
      break;
    }
  }
  const tsArr = rows.map(r => toNum(r.ts_ms)).filter((n): n is number => n !== null);
  const values = rows.map(r => toNum(r.value)).filter((n): n is number => n !== null);
  const tsMax = tsArr.length ? Math.max(...tsArr) : null;
  const tsMin = tsArr.length ? Math.min(...tsArr) : null;
  const staleMs = tsMax==null ? null : Math.max(0, nowMs() - tsMax);
  return { tsMax, tsMin, values, rows, staleMs, usedIx };
}

function evaluate(name:string, pulls:Pull[]) {
  const first = pulls[0]?.tsMax ?? null;
  const last  = pulls[pulls.length-1]?.tsMax ?? null;
  const dbSaving = (first !== null && last !== null && last > first);

  let pollerSynch = false;
  const seq = pulls.map(p=>p.tsMax).filter((n): n is number => n !== null);
  const deltas:number[] = [];
  if (seq.length >= 2) {
    for (let i=1;i<seq.length;i++) deltas.push(seq[i]-seq[i-1]);
    const avg = deltas.reduce((a,b)=>a+b,0)/deltas.length;
    pollerSynch = deltas.every(d => d >= 0) && Math.abs(avg - intervalMs) <= tolerance;
  }

  const required: Record<string, (keyof Row)[]> = {
    matrices: ['ts_ms'],
    mea     : ['ts_ms'],
    cin     : ['ts_ms'],
    str     : ['ts_ms'],
  };
  const req = required[name] ?? required.matrices;
  let completeOk = false;
  outer: for (const p of pulls) {
    for (const r of p.rows) {
      if (req.every(k => r[k] !== null && r[k] !== undefined)) { completeOk = true; break outer; }
    }
  }

  const vals = pulls.flatMap(p => p.values);
  const diffValues = variance(vals) > 0;

  return { dbSaving, pollerSynch, completeOk, diffValues, deltas };
}

async function main() {
  console.log(cyan(`[smoke] poller 4-dom+ (repeats=${repeats}, interval=${intervalMs}ms, tol=${tolerance}ms, limit=${limit})`));

  const client = await getClient();

  // Defaults aligned to your DDL. Override with:
  //   --mea.sql="..."  --cin.sql="..."  --str.sql="..."  --matrices.sql="..."
  const matricesSQLs = [
    (argv['matrices.sql'] ??
      `select matrix_type, base, quote, ts_ms, value from ${schema}.dyn_matrix_values order by ts_ms desc limit $1`)
  ];
  const meaSQLs = [
    (argv['mea.sql'] ??
      `select base, quote, cycle_ts as ts_ms, value, metric from ${schema}.mea_orientations order by cycle_ts desc limit $1`),
    // (no 'mea_values' fallback anymore)
  ];
  const cinSQLs = [
    (argv['cin.sql'] ??
      `select symbol as base, 'USDT' as quote, cycle_ts as ts_ms, wallet_usdt as value from ${schema}.v_cin_aux order by cycle_ts desc limit $1`),
  ];
  const strSQLs = [
    (argv['str.sql'] ??
      `select pair_base as base, pair_quote as quote, last_update_ms as ts_ms, opening_price as value, window_key as metric from ${strategySchema}.str_aux_session order by last_update_ms desc limit $1`),
    `select app_session_id as base, pair as quote, extract(epoch from created_at)*1000 as ts_ms, null::float as value, win as metric from ${schema}.strategy_aux_snapshots order by created_at desc limit $1`,
  ];

  const domains = [
    { name:'matrices', sqls: matricesSQLs },
    { name:'mea',      sqls: meaSQLs },
    { name:'cin',      sqls: cinSQLs },
    { name:'str',      sqls: strSQLs },
  ] as const;

  const history: Record<typeof domains[number]['name'], Pull[]> = {
    matrices: [], mea: [], cin: [], str: [],
  };

  try {
    for (let k=0; k<repeats; k++) {
      console.log(cyan(`• pull ${k+1}/${repeats}`));
      for (const d of domains) {
        const res = await pull(client, d.sqls, limit);
        history[d.name].push(res);
        const head = res.rows[0];
        console.log(
          `  ${bold(d.name)} ts_max=${res.tsMax ?? '—'} stale=${fmtMs(res.staleMs)} rows=${res.rows.length} src=[${res.usedIx ?? '—'}] head.ts=${head?.ts_ms ?? '—'} head.value=${head?.value ?? '—'}`
        );
      }
      if (k < repeats - 1) await sleep(intervalMs);
    }

    console.log(cyan('\n[diagnostics]'));
    for (const d of domains) {
      const ev = evaluate(d.name, history[d.name]);
      const flag = (b:boolean)=> b ? green('✔') : red('✖');
      console.log(bold(`\n${d.name.toUpperCase()}`));
      console.log(`  ${flag(ev.dbSaving)} db saving`);
      console.log(`  ${flag(ev.pollerSynch)} poller synch  deltas=${ev.deltas.length?ev.deltas.join(','):'—'}`);
      console.log(`  ${flag(ev.completeOk)} complete rows/docs`);
      console.log(`  ${flag(ev.diffValues)} different rows values`);
      const last = history[d.name][history[d.name].length-1];
      console.log(`  staleness: ${fmtMs(last?.staleMs ?? null)}`);
    }
  } finally {
    await client.end().catch(()=>{});
  }
}

main().catch(e=>{
  console.error(red('[smoke error]'), e?.message || e);
  process.exitCode = 1;
});
