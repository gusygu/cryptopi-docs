// cin server smoke (discovering pipeline; tolerant API)
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

async function httpJSON(method, path, body){
  const url = path.startsWith("http")?path:`${BASE_URL}${path}`;
  const t0 = Date.now();
  const r = await fetch(url,{ method, headers:{ "content-type":"application/json" }, cache:"no-store", body: body?JSON.stringify(body):undefined });
  let j=null; try{ j=await r.json(); }catch{}
  return { ok:r.ok, status:r.status, json:j, ms:Date.now()-t0, url };
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
    const r = await httpJSON(method, path, {});
    if (r.ok || r.status>=500) return {path,method,ok:r.ok};
  }
  return null;
}
async function triggerSave(){ const f=await discoverRun(); if(!f){warn("No pipeline trigger"); return;} const r=await httpJSON(f.method,f.path,{}); r.ok?ok(`trigger ${f.path}`):warn(`${f.path} -> ${r.status}`); await delay(400); }

async function checkDB(){
  await withPg(async (db)=>{
    const r1 = await db.query(`SELECT COUNT(*)::int AS c FROM cin_aux_cycle`);
    const r2 = await db.query(`SELECT COUNT(*)::int AS c FROM cin_aux_session_acc`);
    const c1 = r1.rows?.[0]?.c ?? 0, c2 = r2.rows?.[0]?.c ?? 0;
    assert(c1>0 || c2>0, `cin tables have no rows (cycle=${c1}, acc=${c2})`);
    if (c1>0) ok(`DB cin_aux_cycle rows (${c1})`); else warn("cin_aux_cycle 0 rows");
    if (c2>0) ok(`DB cin_aux_session_acc rows (${c2})`); else warn("cin_aux_session_acc 0 rows");
  });
}

async function checkAPIs(){
  const tryList = ["/api/cin-aux","/api/dynamics","/api/matrices/latest"];
  let okAny=false;
  for (const p of tryList){
    const r = await httpJSON("GET", p);
    if (r.ok && r.json){ ok(`GET ${p} (${r.ms}ms)`); okAny=true; break; }
    warn(`${p} not OK (${r.status})`);
  }
  assert(okAny, "no CIN endpoint returned valid payload");
}

(async function main(){
  try{
    if(!RET_ONLY){ await triggerSave(); if(!NO_DB) await checkDB(); }
    if(!SAVE_ONLY){ await checkAPIs(); }
    ok("CIN project smoke ✓");
    process.exit(0);
  }catch(e){ fail("CIN project smoke", e); }
})();
