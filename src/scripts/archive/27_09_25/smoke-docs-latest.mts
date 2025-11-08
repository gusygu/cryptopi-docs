// src/scripts/smokes/smoke-docs-latest.mts
// Prints the latest cycle_documents per domain (matrices/mea/cin/str) for an app_session_id.

import { getPool } from "legacy/pool";

const pool = getPool();
const APP_SESSION = (process.env.APP_SESSION_ID || "").trim() || null;

type DocRow = { domain: string; cycle_ts: string | number | null; pairs_count: number | null; rows_count: number | null; created_at: string | null };

function cyan(s:string){return `\x1b[36m${s}\x1b[0m`;}
function bold(s:string){return `\x1b[1m${s}\x1b[0m`;}
function pad(s:any,w=16){const t=String(s==null?'—':s); return t.length>=w?t:t.padEnd(w,' ');}

function fmtStale(ts:number|null){
  if (!ts || !Number.isFinite(ts)) return '—';
  const ms = Math.max(0, Date.now() - ts);
  const s = Math.floor(ms/1000)%60, m=Math.floor(ms/60000)%60, h=Math.floor(ms/3600000);
  if (h>0) return `${h}h ${m}m ${s}s`; if (m>0) return `${m}m ${s}s`; return `${s}s`;
}

async function latestDoc(domain:string, appSessionId:string|null): Promise<{ts:number|null,row:DocRow|null}> {
  const where = appSessionId ? `where domain = $1 and app_session_id = $2` : `where domain = $1`;
  const args = appSessionId ? [domain, appSessionId] : [domain];
  const sql = `
    select domain, app_session_id, cycle_ts::bigint as cycle_ts, pairs_count, rows_count, created_at
      from public.cycle_documents
      ${where}
     order by cycle_ts desc
     limit 1
  `;
  const c = await pool.connect();
  try {
    const r = await c.query(sql, args);
    const row = r.rows[0] as any;
    return { ts: row ? Number(row.cycle_ts) : null, row };
  } finally { c.release(); }
}

async function main() {
  console.log(cyan(`[docs] latest cycle_documents  app_session=${APP_SESSION ?? '—'}`));

  const domains = ['matrices','mea','cin','str'];
  const rows = await Promise.all(domains.map(d => latestDoc(d, APP_SESSION)));

  const header = [bold('DOMAIN'), bold('CYCLE_TS'), bold('STALE'), bold('PAIRS'), bold('ROWS'), bold('CREATED_AT')];
  console.log(header.map(h => pad(h)).join(''));

  for (let i=0;i<domains.length;i++){
    const d = domains[i];
    const ts = rows[i].ts ?? null;
    const row = rows[i].row as any;
    console.log([
      pad(d.toUpperCase()),
      pad(ts ?? '—'),
      pad(fmtStale(ts)),
      pad(row?.pairs_count ?? '—'),
      pad(row?.rows_count ?? '—'),
      pad(row?.created_at ?? '—')
    ].join(''));
  }
}

main().catch(e => { console.error('[docs smoke error]', e?.message || e); process.exit(1); });
