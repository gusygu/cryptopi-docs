// src/scripts/jobs/bridge-docs.mts
// Bridges current API endpoints into cycle_documents (matrices, mea, cin, str).
// Requires APP_SESSION_ID in env.

import { saveCycleDocument } from "@/core/db/cycleDocuments";
import { getPool } from "legacy/pool";

const BASE = process.env.BASE_URL?.trim() || "http://localhost:3000";
const APP_SESSION_ID = process.env.APP_SESSION_ID?.trim() || "";

function cyan(s:string){return `\x1b[36m${s}\x1b[0m`;}
function green(s:string){return `\x1b[32m${s}\x1b[0m`;}
function yel(s:string){return `\x1b[33m${s}\x1b[0m`;}
function red(s:string){return `\x1b[31m${s}\x1b[0m`;}

if (!APP_SESSION_ID) {
  console.error(red("Missing APP_SESSION_ID in env."));
  process.exit(2);
}

async function getJson(path: string) {
  const url = path.startsWith("http") ? path : `${BASE}${path}`;
  const r = await fetch(url, { cache: "no-store" });
  const text = await r.text();
  let json: any = null; try { json = JSON.parse(text); } catch {}
  return { ok: r.ok, status: r.status, json, url };
}

function asMs(v:any): number | null {
  if (v == null) return null;
  const n = Number(v);
  if (Number.isFinite(n)) {
    if (n > 1e12) return n;                 // ms
    if (n > 1e9)  return Math.round(n*1000);// sec -> ms
    return n;
  }
  const t = Date.parse(String(v));
  return Number.isFinite(t) ? t : null;
}

/** MATRICES: pick max ts across all matrices */
function extractMatricesTs(payload:any): number | null {
  if (!payload || typeof payload !== "object") return null;
  const mats = payload.matrices ?? payload.data ?? payload;
  if (!mats || typeof mats !== "object") return null;
  let maxTs: number | null = null;
  for (const k of Object.keys(mats)) {
    const arr = mats[k];
    if (!Array.isArray(arr)) continue;
    for (const row of arr) {
      if (!Array.isArray(row) || row.length === 0) continue;
      const ts = asMs(row[0]);
      if (ts != null) maxTs = maxTs == null ? ts : Math.max(maxTs, ts);
    }
  }
  return maxTs;
}
function matricesCounts(payload:any): {pairs:number, cells:number}{
  const mats = payload?.matrices ?? payload?.data ?? {};
  const anyGrid = Object.values(mats)[0] as any[] | undefined;
  if (!Array.isArray(anyGrid)) return { pairs: 0, cells: 0 };
  // heuristics: rows ≈ list length, cells ≈ sum of row lengths - 1 (excluding ts col) * rows
  let cells = 0; let pairs = 0;
  for (const row of anyGrid) {
    if (Array.isArray(row)) { pairs++; cells += Math.max(0, row.length - 1); }
  }
  return { pairs, cells };
}

/** CIN: expect { cycle_ts, ... } */
function extractCinTs(payload:any): number | null {
  return asMs(payload?.cycle_ts ?? payload?.ts ?? null);
}
function cinCounts(payload:any): {rows:number}{
  const rows = Array.isArray(payload?.rows) ? payload.rows.length : (Array.isArray(payload) ? payload.length : 1);
  return { rows };
}

/** MEA: try cycle_ts in top-level; fallback to now */
function extractMeaTs(payload:any): number | null {
  return asMs(payload?.cycle_ts ?? payload?.ts ?? null);
}
function meaCounts(payload:any): {pairs:number, cells:number}{
  const grid = payload?.grid || {};
  const coins = Object.keys(grid);
  let cells = 0;
  for (const a of coins) {
    const row = grid[a]; if (row && typeof row === "object") cells += Object.keys(row).length;
  }
  return { pairs: coins.length, cells };
}

/** STR: latest session: { session: { last_update_ms, ... } } */
function extractStrTs(payload:any): number | null {
  return asMs(payload?.session?.last_update_ms ?? payload?.session?.opening_ts ?? null);
}

async function main() {
  console.log(cyan(`[bridge] endpoints → cycle_documents  base=${BASE} app_session=${APP_SESSION_ID}`));
  const pool = getPool();

  // MATRICES
  try {
    const r = await getJson("/api/matrices/latest");
    if (r.ok && r.json) {
      const ts = extractMatricesTs(r.json) ?? Date.now();
      const { pairs, cells } = matricesCounts(r.json);
      await saveCycleDocument({
        domain: "matrices",
        appSessionId: APP_SESSION_ID,
        cycleTs: ts,
        payload: r.json,
        pairsCount: pairs,
        rowsCount: cells,
        notes: "bridge: from /api/matrices/latest"
      });
      console.log(green(`✓ matrices doc @ ${ts}  pairs=${pairs} cells=${cells}`));
    } else {
      console.log(yel(`∙ matrices skipped (${r.status})`));
    }
  } catch (e:any) { console.log(yel(`∙ matrices error: ${e?.message||e}`)); }

  // MEA
  try {
    const r = await getJson("/api/mea-aux");
    if (r.ok && r.json) {
      const ts = extractMeaTs(r.json) ?? Date.now();
      const { pairs, cells } = meaCounts(r.json);
      await saveCycleDocument({
        domain: "mea",
        appSessionId: APP_SESSION_ID,
        cycleTs: ts,
        payload: r.json,
        pairsCount: pairs,
        rowsCount: cells,
        notes: "bridge: from /api/mea-aux"
      });
      console.log(green(`✓ mea doc @ ${ts}  pairs=${pairs} cells=${cells}`));
    } else {
      console.log(yel(`∙ mea skipped (${r.status})`));
    }
  } catch (e:any) { console.log(yel(`∙ mea error: ${e?.message||e}`)); }

  // CIN
  try {
    const r = await getJson("/api/cin-aux");
    if (r.ok && r.json) {
      const ts = extractCinTs(r.json) ?? Date.now();
      const { rows } = cinCounts(r.json);
      await saveCycleDocument({
        domain: "cin",
        appSessionId: APP_SESSION_ID,
        cycleTs: ts,
        payload: r.json,
        rowsCount: rows,
        notes: "bridge: from /api/cin-aux"
      });
      console.log(green(`✓ cin doc @ ${ts}  rows=${rows}`));
    } else {
      console.log(yel(`∙ cin skipped (${r.status})`));
    }
  } catch (e:any) { console.log(yel(`∙ cin error: ${e?.message||e}`)); }

  // STR
  try {
    const r = await getJson("/api/str-aux/latest");
    if (r.ok && r.json) {
      const ts = extractStrTs(r.json) ?? Date.now();
      await saveCycleDocument({
        domain: "str",
        appSessionId: APP_SESSION_ID,
        cycleTs: ts,
        payload: r.json,
        notes: "bridge: from /api/str-aux/latest"
      });
      console.log(green(`✓ str doc @ ${ts}`));
    } else {
      console.log(yel(`∙ str skipped (${r.status})`));
    }
  } catch (e:any) { console.log(yel(`∙ str error: ${e?.message||e}`)); }

  // end
  await pool.end().catch(()=>{});
}

main().catch(e => { console.error(red("[bridge error]"), e?.message || e); process.exit(1); });
