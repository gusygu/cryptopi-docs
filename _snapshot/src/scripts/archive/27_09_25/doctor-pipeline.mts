// src/scripts/smokes/doctor-pipeline.mts
// Doctor: end-to-end freshness across MATRICES, STR, CIN, MEA.
// Hops:
//   MATRICES: /api/matrices/latest  -> public.dyn_matrix_values
//   STR     : /api/str-aux/latest   -> public.strategy_aux_snapshots -> strategy_aux.str_aux_session
//   CIN     : /api/cin-aux          -> public.v_cin_aux
//   MEA     : /api/mea-aux          -> public.mea_orientations
// Also shows DOC_TS from public.cycle_documents (per domain & APP_SESSION_ID).

// -------- tiny arg parser (zero-dep) ----------
const argv = (() => {
  const o: Record<string,string> = {};
  for (let i=2;i<process.argv.length;i++){
    const a = process.argv[i];
    if (a.startsWith('--')) { const [k,v] = a.slice(2).split('='); o[k] = v ?? 'true'; }
  }
  return o;
})();

const BASE        = argv.baseUrl || process.env.BASE_URL || 'http://localhost:3000';
const SCHEMA      = argv.schema || process.env.DB_SCHEMA || 'public';
const STR_SCHEMA  = argv['strategy.schema'] || 'strategy_aux';
const APP_SESSION = process.env.APP_SESSION_ID || null;
const IS_WIN      = process.platform === 'win32';
const SHOW_HINTS  = argv.hints === 'true' || argv.hints === '' || argv.hints === '1';

// -------- DB client import with inline fallback ----------
let getClient: ()=>Promise<any>;
try {
  // @ts-ignore
  ({ getClient } = await import('../../utils/db.mjs'));
} catch {
  const { Client } = await import('pg');
  getClient = async () => {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) throw new Error('Missing env: DATABASE_URL');
    const client = new Client({ connectionString, statement_timeout: 30000, application_name: 'doctor-pipeline' });
    await client.connect();
    return client;
  };
}

// -------- console helpers ----------
const cyan = (s:string)=>`\x1b[36m${s}\x1b[0m`;
const green=(s:string)=>`\x1b[32m${s}\x1b[0m`;
const red  =(s:string)=>`\x1b[31m${s}\x1b[0m`;
const yel  =(s:string)=>`\x1b[33m${s}\x1b[0m`;
const bold =(s:string)=>`\x1b[1m${s}\x1b[0m`;
const dim  =(s:string)=>`\x1b[2m${s}\x1b[0m`;

function line(...cols:(string|number)[]){ console.log(cols.map(c => String(c).padEnd(16,' ')).join('')); }

// -------- time helpers ----------
function asEpochMs(v:any): number | null {
  if (v==null) return null;
  if (typeof v === 'number' && Number.isFinite(v)) {
    if (v > 1e12) return v;                 // ms
    if (v > 1e9 && v <= 1e12) return Math.round(v*1000); // sec -> ms
    return v;
  }
  const n = Number(v);
  if (Number.isFinite(n)) {
    if (n > 1e12) return n;
    if (n > 1e9 && n <= 1e12) return Math.round(n*1000);
    return n;
  }
  const t = Date.parse(String(v));
  return Number.isFinite(t) ? t : null;
}
function fmtTs(ts:number|null){ return ts==null ? '—' : String(ts); }
function fmtStale(ts:number|null){
  if (ts==null || !Number.isFinite(ts)) return '—';
  const ms = Math.max(0, Date.now() - ts);
  const s = Math.floor(ms/1000)%60, m = Math.floor(ms/60000)%60, h = Math.floor(ms/3600000);
  if (h>0) return `${h}h ${m}m ${s}s`; if (m>0) return `${m}m ${s}s`; return `${s}s`;
}

// -------- HTTP helpers ----------
async function fetchJson(path:string){
  const url = path.startsWith('http') ? path : (BASE + path);
  try {
    // Node 18+ has fetch; in older runtimes consider undici
    const r = await fetch(url, { cache:'no-store' } as any);
    const txt = await r.text();
    let json:any = null; try { json = JSON.parse(txt); } catch {}
    return { ok:r.ok, status:r.status, json, text:txt, url };
  } catch (e:any) {
    return { ok:false, status:0, json:null, text:String(e?.message||e), url:path };
  }
}

// -------- endpoint pickers ----------
function pickMatricesTs(payload:any): number | null {
  if (!payload || typeof payload !== 'object') return null;
  const mats = (payload as any).matrices ?? (payload as any).data ?? payload;
  if (!mats || typeof mats !== 'object') return null;
  let maxTs: number | null = null;
  for (const k of Object.keys(mats)) {
    const arr = (mats as any)[k];
    if (!Array.isArray(arr)) continue;
    for (const row of arr) {
      if (!Array.isArray(row) || row.length === 0) continue;
      const ts = asEpochMs(row[0]);
      if (ts != null) maxTs = maxTs==null ? ts : Math.max(maxTs, ts);
    }
  }
  return maxTs;
}
function pickCinTs(payload:any): number | null {
  if (!payload || typeof payload !== 'object') return null;
  return asEpochMs((payload as any).ts ?? (payload as any).cycleTs ?? null);
}
function pickStrTs(payload:any): number | null {
  if (!payload || typeof payload !== 'object') return null;
  const snap = (payload as any).snapshot ?? payload;
  if (snap && typeof snap === 'object') {
    return asEpochMs((snap as any).ts_ms) ??
           asEpochMs((snap as any).last_update_ms) ??
           asEpochMs((snap as any).created_at) ??
           asEpochMs((snap as any).updated_at) ?? null;
  }
  return null;
}
function pickMeaShape(payload:any): string {
  if (!payload || typeof payload !== 'object') return '—';
  const grid = (payload as any).grid;
  if (!grid || typeof grid !== 'object') return 'grid: —';
  const coins = Object.keys(grid); let cells = 0;
  for (const a of coins) { const row = (grid as any)[a]; if (row && typeof row === 'object') cells += Object.keys(row).length; }
  return `grid: ${coins.length}×? cells≈${cells}`;
}

// -------- DB helpers ----------
async function trySql(client:any, sql:string): Promise<any[]|null> {
  try { const { rows } = await client.query(sql); return rows ?? []; }
  catch { return null; }
}
async function maxTsFromFirstOk(client:any, sqls:string[]): Promise<number|null> {
  for (const sql of sqls) {
    const rows = await trySql(client, sql);
    if (!rows) continue;
    const ts = asEpochMs(rows[0]?.ts ?? null);
    if (ts != null || rows.length >= 0) return ts ?? null;
  }
  return null;
}
async function maxDocTs(client:any, domain:'matrices'|'str'|'cin'|'mea', appSessionId:string|null): Promise<number|null> {
  if (!appSessionId) return null;
  try {
    const { rows } = await client.query(
      `select max(cycle_ts)::bigint as ts
         from public.cycle_documents
        where domain = $1 and app_session_id = $2`,
      [domain, appSessionId]
    );
    return rows[0]?.ts ?? null;
  } catch { return null; }
}

// -------- SQL plans (idempotent, skip if missing) ----------
const MATRICES_DB_SQL = [ `select max(ts_ms)::bigint as ts from ${SCHEMA}.dyn_matrix_values` ];
const STR_SNAPSHOT_SQL = [ `select (extract(epoch from max(created_at))*1000)::bigint as ts from ${SCHEMA}.strategy_aux_snapshots` ];
const STR_SESSION_SQL  = [ `select max(last_update_ms)::bigint as ts from ${STR_SCHEMA}.str_aux_session` ];
const CIN_DB_SQL       = [ `select max(cycle_ts)::bigint as ts from ${SCHEMA}.v_cin_aux` ];
const MEA_DB_SQL       = [ `select max(cycle_ts)::bigint as ts from ${SCHEMA}.mea_orientations` ];

// -------- verdicts ----------
type DomainRow = {
  domain: 'MATRICES'|'STR'|'CIN'|'MEA';
  src_ts: number|null;
  snap_ts?: number|null;
  sess_or_db_ts?: number|null;
  doc_ts?: number|null;
  src_ok: boolean;
  notes?: string;
};
function verdict(r:DomainRow): string {
  if (r.domain === 'MATRICES') {
    const d = r.sess_or_db_ts ?? null, s = r.src_ts;
    if (!r.src_ok && d==null) return 'No data (endpoint+DB)';
    if (!r.src_ok && d!=null) return 'Endpoint down, DB has data';
    if ( r.src_ok && d==null) return 'Writer missing (DB empty)';
    if (s!=null && d!=null) {
      if (s - d > 60_000) return 'DB lagging vs endpoint';
      if (d - s > 60_000) return 'Endpoint lagging vs DB';
      return 'OK (src≈db)';
    }
    return 'Inconclusive';
  }
  if (r.domain === 'STR') {
    const src=r.src_ts, snap=r.snap_ts ?? null, sess=r.sess_or_db_ts ?? null;
    if (!r.src_ok && snap==null && sess==null) return 'No data (endpoint+snap+session)';
    if ( r.src_ok && snap==null) return 'Ingest missing (snapshots not updating)';
    if ( snap!=null && sess==null) return 'Session refresher missing';
    if ( snap!=null && sess!=null) {
      if (snap - sess > 60_000) return 'Session lagging vs snapshots';
      if (!r.src_ok) return 'Endpoint down, storage fresh';
      if (src!=null && Math.abs(sess - src) > 60_000) return 'Endpoint vs session mismatch';
      return 'OK';
    }
    return 'Inconclusive';
  }
  if (r.domain === 'CIN') {
    const d=r.sess_or_db_ts ?? null, s=r.src_ts;
    if (!r.src_ok && d==null) return 'No data (endpoint+DB)';
    if ( r.src_ok && d==null) return 'Writer missing (DB empty)';
    if (!r.src_ok && d!=null) return 'Endpoint down, DB fresh';
    if (s!=null && d!=null) {
      if (s - d > 60_000) return 'DB lagging vs endpoint';
      if (d - s > 60_000) return 'Endpoint lagging vs DB';
      return 'OK';
    }
    return 'Inconclusive';
  }
  // MEA: no src_ts; check reachability and db_ts
  if (r.domain === 'MEA') {
    const d=r.sess_or_db_ts ?? null;
    if (!r.src_ok && d==null) return 'No data (endpoint+DB)';
    if (d==null) return 'DB empty/stale';
    if (!r.src_ok) return 'Endpoint down, DB fresh';
    return 'OK (no src ts)';
  }
  return 'Inconclusive';
}

// -------- hints ----------
function hintFor(domain: DomainRow['domain'], v: string): string[] | null {
  const baseCmd = 'pnpm';
  const envLinePosix = `APP_SESSION_ID=${APP_SESSION ?? 'dev-01'}`;
  const envLinePwsh  = `$env:APP_SESSION_ID='${APP_SESSION ?? 'dev-01'}'`;
  const envShow = IS_WIN ? envLinePwsh : envLinePosix;

  if (domain === 'MATRICES') {
    if (v.includes('Writer missing')) {
      return [
        'Matrix writer seems down / DB empty.',
        'Try seeding a minimal grid then verify counts:',
        `${baseCmd} smoke:scs:write-trace -- --bases=BTC,ETH --quote=USDT --type=benchmark`,
        `${baseCmd} smoke:scs:read-trace -- --type=benchmark --bases=BTC,ETH,SOL`
      ];
    }
    if (v.includes('Endpoint down')) {
      return ['Matrices endpoint not reachable. Check Next API /api/matrices/latest route & server logs.'];
    }
    if (v.includes('lagging')) {
      return ['Lag detected. Ensure writer job cadence matches UI poll interval; check DB locks and indexes.'];
    }
  }

  if (domain === 'STR') {
    if (v.includes('Ingest missing') || v.includes('No data (endpoint+snap+session)')) {
      return [
        'STR snapshots not updating. Seed from bins and/or start snapshot ingest:',
        `${envShow}; ${baseCmd} run job:straux:seed`,
      ];
    }
    if (v.includes('Session refresher missing') || v.includes('Session lagging')) {
      return [
        'STR session refresher not advancing:',
        `${envShow}; ${baseCmd} run job:str:refresh`
      ];
    }
    if (v.includes('Endpoint down')) {
      return ['STR endpoint not reachable. Check /api/str-aux/latest handler and server logs.'];
    }
  }

  if (domain === 'CIN') {
    if (v.includes('Writer missing')) {
      return [
        'CIN view/DB empty. Start CIN writer or backfill:',
        `${baseCmd} run job:cin:refresh   # if exists`,
        'Or verify that public.v_cin_aux reads from a populated base table.'
      ];
    }
    if (v.includes('Endpoint down')) {
      return ['CIN endpoint not reachable. Check /api/cin-aux handler and DB view public.v_cin_aux.'];
    }
  }

  if (domain === 'MEA') {
    if (v.includes('DB empty/stale')) {
      return [
        'MEA table is empty/stale. Run the MEA orienter refresh/backfill:',
        `${baseCmd} run job:mea:refresh   # if exists`,
        'Or confirm writer populates public.mea_orientations.'
      ];
    }
    if (v.includes('Endpoint down')) {
      return ['MEA endpoint not reachable. Check /api/mea-aux and its dependencies.'];
    }
  }
  return null;
}

// -------- main ----------
async function main(){
  console.log(cyan(`[doctor] pipeline — base=${BASE} schema=${SCHEMA} strategy=${STR_SCHEMA} app_session=${APP_SESSION ?? '—'}`));
  const client = await getClient();

  // 1) endpoints
  const [vHealth, vStatus, mLatest, cin, mea, strLatest] = await Promise.all([
    fetchJson('/api/vitals/health'),
    fetchJson('/api/vitals/status'),
    fetchJson('/api/matrices/latest'),
    fetchJson('/api/cin-aux'),
    fetchJson('/api/mea-aux'),
    fetchJson('/api/str-aux/latest'),
  ]);
  const appTs = vStatus.ok ? asEpochMs((vStatus.json as any)?.app?.ts ?? (vStatus.json as any)?.ts_ms ?? null) : null;
  const matricesSrcTs = mLatest.ok ? pickMatricesTs(mLatest.json) : null;
  const cinSrcTs      = cin.ok ? pickCinTs(cin.json) : null;
  const meaReachable  = mea.ok;
  const strSrcTs      = strLatest.ok ? pickStrTs(strLatest.json) : null;

  // 2) DB hops
  const [matricesDbTs, strSnapTs, strSessTs, cinDbTs, meaDbTs] = await Promise.all([
    maxTsFromFirstOk(client, MATRICES_DB_SQL),
    maxTsFromFirstOk(client, STR_SNAPSHOT_SQL),
    maxTsFromFirstOk(client, STR_SESSION_SQL),
    maxTsFromFirstOk(client, CIN_DB_SQL),
    maxTsFromFirstOk(client, MEA_DB_SQL),
  ]);

  // 3) DOCs (cycle_documents)
  const [matricesDocTs, strDocTs, cinDocTs, meaDocTs] = await Promise.all([
    maxDocTs(client, 'matrices', APP_SESSION),
    maxDocTs(client, 'str',      APP_SESSION),
    maxDocTs(client, 'cin',      APP_SESSION),
    maxDocTs(client, 'mea',      APP_SESSION),
  ]);

  // 4) assemble rows
  const rows: DomainRow[] = [
    { domain:'MATRICES', src_ts: matricesSrcTs, sess_or_db_ts: matricesDbTs, doc_ts: matricesDocTs, src_ok: mLatest.ok },
    { domain:'STR',      src_ts: strSrcTs,      snap_ts: strSnapTs, sess_or_db_ts: strSessTs, doc_ts: strDocTs, src_ok: strLatest.ok },
    { domain:'CIN',      src_ts: cinSrcTs,      sess_or_db_ts: cinDbTs, doc_ts: cinDocTs, src_ok: cin.ok },
    { domain:'MEA',      src_ts: null,          sess_or_db_ts: meaDbTs, doc_ts: meaDocTs, src_ok: meaReachable, notes: meaReachable? pickMeaShape(mea.json) : undefined },
  ];

  // 5) print table
  console.log('');
  line(bold('DOMAIN'), bold('SRC_TS'), bold('SNAP_TS'), bold('SESS/DB_TS'), bold('DOC_TS'), bold('STALE(src)'), bold('STALE(mid/db)'), bold('STALE(doc)'), bold('VERDICT'));

  for (const r of rows) {
    const src  = r.src_ts ?? null;
    const mid  = r.snap_ts ?? null;
    const last = r.sess_or_db_ts ?? null;
    const doc  = r.doc_ts ?? null;

    const v     = verdict(r);
    const color = v.startsWith('OK') ? green : v.includes('lag') ? yel : red;

    line(
      r.domain,
      fmtTs(src),
      fmtTs(mid),
      fmtTs(last),
      fmtTs(doc),
      fmtStale(src),
      fmtStale(mid ?? last),
      fmtStale(doc),
      color(v)
    );

    if (r.notes) console.log(dim(`  notes: ${r.notes}`));

    if (SHOW_HINTS) {
      const hints = hintFor(r.domain, v);
      if (hints?.length) {
        console.log(dim('  hints:'));
        for (const h of hints) console.log(dim(`    • ${h}`));
      }
    }
  }

  // 6) vitals
  console.log('\n' + cyan('[vitals]'));
  console.log(`health: ${vHealth.ok ? green('OK') : red('FAIL')}   status: ${vStatus.ok ? green('OK') : red('FAIL')}   app.stale=${fmtStale(appTs)}`);

  await client.end().catch(()=>{});
}

main().catch(e=>{
  console.error(red('[doctor error]'), e?.message || e);
  process.exitCode = 1;
});
