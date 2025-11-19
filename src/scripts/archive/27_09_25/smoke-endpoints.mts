// src/scripts/smokes/smoke-endpoints.mts
// Aligned to your repo endpoints. Probes and extracts “freshness” hints.
//
// Usage:
//   pnpm smoke:diag:endpoints
//   # optional: BASE_URL in .env (default http://localhost:3000)

const base = process.env.BASE_URL || "http://localhost:3000";

const cyan = (s:string)=>`\x1b[36m${s}\x1b[0m`;
const green=(s:string)=>`\x1b[32m${s}\x1b[0m`;
const red  =(s:string)=>`\x1b[31m${s}\x1b[0m`;
const yel  =(s:string)=>`\x1b[33m${s}\x1b[0m`;

function fmtStale(ts:number|null){
  if (ts==null || !Number.isFinite(ts)) return "—";
  const now = Date.now();
  const ms = Math.max(0, now - ts);
  const s = Math.floor(ms/1000)%60;
  const m = Math.floor(ms/60000)%60;
  const h = Math.floor(ms/3600000);
  if (h>0) return `${h}h ${m}m ${s}s`;
  if (m>0) return `${m}m ${s}s`;
  return `${s}s`;
}
function asEpochMs(v:any): number | null {
  if (v == null) return null;
  // numeric epoch ms
  if (typeof v === 'number' && Number.isFinite(v)) {
    // If it looks like seconds (<= 1e12), scale to ms only when value is in seconds-range
    if (v > 1e12) return v;
    if (v > 1e9 && v <= 1e12) return Math.round(v * 1000);
    return v;
  }
  // numeric string
  const n = Number(v);
  if (Number.isFinite(n)) {
    if (n > 1e12) return n;
    if (n > 1e9 && n <= 1e12) return Math.round(n * 1000);
    return n;
  }
  // ISO-ish date string
  const t = Date.parse(String(v));
  return Number.isFinite(t) ? t : null;
}

/* ---------------- matrices/latest (list-of-lists) ---------------- */
function pickLatestTsFromMatricesLatest(payload:any): number | null {
  // Expect: { matrices: { benchmark: [[ts, val, ...], ...], ref: [...], pct24h: [...], id_pct: [...], ... } }
  // We'll scan for a numeric ts at [0] and take max across all present matrices.
  if (!payload || typeof payload !== 'object') return null;
  const mats = payload.matrices || payload.data || payload;
  const keys = Object.keys(mats || {});
  let maxTs: number | null = null;

  for (const k of keys) {
    const arr = mats[k];
    if (!Array.isArray(arr)) continue;
    for (const row of arr) {
      if (!Array.isArray(row) || row.length === 0) continue;
      const ts = asEpochMs(row[0]);
      if (ts != null) maxTs = maxTs == null ? ts : Math.max(maxTs, ts);
    }
  }
  return maxTs;
}

/* ---------------- cin-aux (has ts & cycleTs) ---------------- */
function pickTsFromCinAux(payload:any): number | null {
  if (!payload || typeof payload !== 'object') return null;
  return asEpochMs(payload.ts ?? payload.cycleTs ?? null);
}

/* ---------------- moo-aux (no explicit ts) ---------------- */
function pickShapeFromMooAux(payload:any): string {
  if (!payload || typeof payload !== 'object') return '—';
  const grid = (payload as any).grid;
  if (!grid || typeof grid !== 'object') return 'grid: —';
  // count first-level keys (coins) and nested keys
  const coins = Object.keys(grid);
  let cells = 0;
  for (const a of coins) {
    const row = grid[a];
    if (row && typeof row === 'object') {
      cells += Object.keys(row).length;
    }
  }
  return `grid: ${coins.length}×? cells≈${cells}`;
}

/* ---------------- str-aux/latest (snapshot object) ---------------- */
function pickTsFromStrAuxLatest(payload:any): number | null {
  if (!payload || typeof payload !== 'object') return null;
  const snap = (payload as any).snapshot ?? payload;
  if (snap && typeof snap === 'object') {
    return (
      asEpochMs(snap.ts_ms) ??
      asEpochMs(snap.last_update_ms) ??
      asEpochMs(snap.created_at) ??
      asEpochMs(snap.updated_at) ??
      null
    );
  }
  return null;
}

async function fetchJson(path:string){
  const url = base + path;
  try {
    const r = await fetch(url, { cache: "no-store" });
    const text = await r.text();
    let json:any = null;
    try { json = JSON.parse(text); } catch { /* leave as text */ }
    return { ok: r.ok, status: r.status, json, text, url };
  } catch (e:any) {
    return { ok: false, status: 0, json: null, text: String(e?.message || e), url };
  }
}

function mark(ok:boolean){ return ok ? green('OK') : red('FAIL'); }

async function main(){
  console.log(cyan(`[smoke] endpoint sampler  base=${base}`));

  // vitals
  {
    const r = await fetchJson('/api/vitals/health');
    console.log(`${mark(r.ok)} /api/vitals/health  status=${r.status}  hint=—`);
  }
  {
    const r = await fetchJson('/api/vitals/status');
    const ts = r.json && typeof r.json === 'object'
      ? asEpochMs((r.json as any).app?.ts ?? (r.json as any).ts_ms ?? null)
      : null;
    console.log(`${mark(r.ok)} /api/vitals/status  status=${r.status}  hint=stale=${fmtStale(ts)}`);
  }

  // matrices/latest
  {
    const r = await fetchJson('/api/matrices/latest');
    const ts = r.ok ? pickLatestTsFromMatricesLatest(r.json) : null;
    console.log(`${mark(r.ok)} /api/matrices/latest  status=${r.status}  hint=stale=${fmtStale(ts)}`);
  }

  // cin-aux
  {
    const r = await fetchJson('/api/cin-aux');
    const ts = r.ok ? pickTsFromCinAux(r.json) : null;
    const rows = r.ok && r.json && typeof r.json === 'object' && Array.isArray((r.json as any).rows)
      ? (r.json as any).rows.length : '—';
    console.log(`${mark(r.ok)} /api/cin-aux  status=${r.status}  hint=rows=${rows} stale=${fmtStale(ts)}`);
  }

  // moo-aux
  {
    const r = await fetchJson('/api/moo-aux');
    const shape = r.ok ? pickShapeFromMooAux(r.json) : '-';
    console.log(`${mark(r.ok)} /api/moo-aux  status=${r.status}  hint=${shape}`);
  }

  // str-aux/latest
  {
    const r = await fetchJson('/api/str-aux/latest');
    const ts = r.ok ? pickTsFromStrAuxLatest(r.json) : null;
    console.log(`${mark(r.ok)} /api/str-aux/latest  status=${r.status}  hint=stale=${fmtStale(ts)}`);
  }
}

main().catch((e:any)=>{
  console.error(red('[smoke error]'), e?.message || e);
  process.exitCode = 1;
});

