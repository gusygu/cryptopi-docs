// matrices server smoke v2.1 — shows pipeline 500 body + table existence guard
import process from "node:process";
import { setTimeout as delay } from "node:timers/promises";

const OPT = new Set(process.argv.slice(2));
const NO_DB = OPT.has("--no-db");
const SAVE_ONLY = OPT.has("--save-only");
const RET_ONLY = OPT.has("--retrieve-only");

const BASE_URL = (process.env.BASE_URL || "http://localhost:3000").trim();
const DATABASE_URL = (process.env.DATABASE_URL || "").trim();

function ok(m){ console.log(`✔ ${m}`); }
function warn(m){ console.warn(`• ${m}`); }
function fail(m,e){ console.error(`✖ ${m} — ${e?.message||e}`); process.exit(1); }
function assert(c,m){ if(!c) throw new Error(m); }

async function req(method, path, body){
  const url = path.startsWith("http") ? path : `${BASE_URL}${path}`;
  const t0 = Date.now();
  const r = await fetch(url, { method, cache:"no-store", headers:{"content-type":"application/json"}, body: body?JSON.stringify(body):undefined });
  const text = await r.text().catch(()=> ""); let json=null; try{ json=JSON.parse(text); }catch{}
  return { ok:r.ok, status:r.status, ms:Date.now()-t0, json, text: text?.slice(0,800), url, ctype:r.headers.get("content-type")||"" };
}

async function withPg(fn){
  if (NO_DB) throw new Error("--no-db set");
  let pg; try{ pg = await import("pg"); }catch{ throw new Error("pg not installed. pnpm add -D pg"); }
  if(!DATABASE_URL) throw new Error("DATABASE_URL not set");
  const c = new pg.Client({ connectionString: DATABASE_URL }); await c.connect();
  try{ return await fn(c); } finally{ await c.end(); }
}

async function discoverRun(){
  for (const [path,method] of [["/api/pipeline/run-once","POST"],["/api/pipeline/run","POST"],["/api/pipeline/tick","POST"]]){
    const r = await req(method, path, {});
    if (r.status !== 404) return {path,method,resp:r};
  }
  return null;
}

async function triggerSave() {
  const found = await discoverRun();
  if (!found) { warn("No pipeline trigger found — skipping tick"); return; }
  const { path, method, resp } = found;
  if (resp.ok) ok(`triggered ${path} (${resp.ms}ms)`);
  else {
    console.warn(`• ${path} -> ${resp.status}`);
    if (resp.status >= 500) console.warn(`— body —\n${resp.text}\n— end —`);
  }
  await delay(400);
}

async function checkDB(){
  await withPg(async (db)=>{
    const exists = await db.query(`
      SELECT 1 FROM information_schema.tables
      WHERE table_schema='public' AND table_name='dyn_matrix_values' LIMIT 1`);
    assert(exists.rowCount===1, "table public.dyn_matrix_values is missing (run DDL)");
    const r = await db.query(`
      SELECT COUNT(*)::int AS c
      FROM public.dyn_matrix_values
      WHERE ts_ms > (EXTRACT(EPOCH FROM now())*1000 - 60*60*1000)`);
    const c = r.rows?.[0]?.c ?? 0;
    assert(c>0, `dyn_matrix_values recent rows should be >0, got ${c}`);
    ok(`DB dyn_matrix_values recent rows (${c})`);
  });
}

function looksItem(x){ return x && typeof x==="object" && typeof x.symbol==="string"; }
async function checkAPIs(){
  const tryList = ["/api/matrices/latest","/api/matrices","/api/matrices/server"];
  let okAny=false;
  for (const p of tryList){
    const r = await req("GET", p);
    if (r.ok && Array.isArray(r.json) && r.json.length && looksItem(r.json[0])) { ok(`GET ${p} (${r.ms}ms)`); okAny=true; break; }
    if (r.ok && r.json) { ok(`GET ${p} (${r.ms}ms)`); okAny=true; break; }
    warn(`${p} -> ${r.status}`);
    if (r.status >= 500) console.warn(`— body —\n${r.text}\n— end —`);
  }
  assert(okAny, "no matrices endpoint returned valid payload");
}

(async function main(){
  try{
    if(!RET_ONLY){ await triggerSave(); if(!NO_DB) await checkDB(); }
    if(!SAVE_ONLY){ await checkAPIs(); }
    ok("Matrices project smoke ✓");
    process.exit(0);
  }catch(e){ fail("Matrices project smoke", e); }
})();
