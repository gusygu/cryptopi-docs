// Server Doctor v2.1 — shows 500 bodies + hints
import process from "node:process";
import { setTimeout as delay } from "node:timers/promises";

const OPT = new Set(process.argv.slice(2));
const NO_DB = OPT.has("--no-db");
const PIPE_ONLY = OPT.has("--pipeline-only");
const SAVE_ONLY = OPT.has("--save-only");
const RET_ONLY = OPT.has("--retrieve-only");

const BASE_URL = (process.env.BASE_URL || "http://localhost:3000").trim();
const DATABASE_URL = (process.env.DATABASE_URL || "").trim();
const APP_SESSION_ID = (process.env.APP_SESSION_ID || "local-dev").trim();

function ok(m){ console.log(`✔ ${m}`); }
function warn(m){ console.warn(`• ${m}`); }
function fail(m,e){ console.error(`✖ ${m} — ${e?.message||e}`); process.exit(1); }
function assert(c,m){ if(!c) throw new Error(m); }

async function req(method, path, body){
  const url = path.startsWith("http") ? path : `${BASE_URL}${path}`;
  const t0 = Date.now();
  let res, text = "";
  try {
    res = await fetch(url, {
      method, cache:"no-store",
      headers: { "content-type": "application/json" },
      body: body ? JSON.stringify(body) : undefined
    });
    text = await res.text().catch(()=> "");
  } catch(e) {
    throw new Error(`fetch error for ${url}: ${e?.message||e}`);
  }
  // try JSON parse (but keep raw text for error body)
  let json = null; try { json = JSON.parse(text); } catch {}
  return { ok: res.ok, status: res.status, ms: Date.now()-t0, json, text: text?.slice(0,800), url, ctype: res.headers.get("content-type")||"" };
}

async function withPg(fn){
  if (NO_DB) throw new Error("--no-db set");
  let pg; try { pg = await import("pg"); } catch { throw new Error("pg not installed. pnpm add -D pg"); }
  if (!DATABASE_URL) throw new Error("DATABASE_URL not set");
  const c = new pg.Client({ connectionString: DATABASE_URL });
  await c.connect();
  try { return await fn(c); } finally { await c.end(); }
}

async function discoverPipeline(){
  const candidates = [
    ["POST","/api/pipeline/run-once"],
    ["POST","/api/pipeline/run"],
    ["POST","/api/pipeline/tick"],
    ["POST","/api/pipeline/step"],
    ["POST","/api/pipeline/trigger"],
  ];
  for (const [m,p] of candidates) {
    const r = await req(m,p,{});
    if (r.status !== 404) return { m, p, r }; // found something (even 500)
  }
  return null;
}

function hintFrom(bodyOrCtype){
  const s = (bodyOrCtype||"").toLowerCase();
  if (s.includes("ecconnrefused") || s.includes("connection refused")) return "DB isn’t reachable (check DATABASE_URL host/port).";
  if (s.includes("password authentication failed")) return "DB auth failed (user/pass).";
  if (s.includes("relation") && s.includes("does not exist")) return "A required table is missing (run DDL).";
  if (s.includes("module not found")) return "A server import failed — check missing dependency or bad path alias.";
  if (s.includes("prisma")) return "Prisma error — ensure schema and migration applied.";
  return null;
}

async function pipelineSuite(){
  const h = await req("GET","/api/vitals/health");
  if (!h.ok) {
    console.error(`✖ /api/vitals/health -> ${h.status} (${h.ms}ms)`);
    if (h.status >= 500) console.error(`— body —\n${h.text}\n— end —`);
    const hint = hintFrom(h.text || h.ctype); if (hint) console.warn(`• hint: ${hint}`);
    throw new Error("/api/vitals/health should be 200");
  }
  ok(`vitals/health (${h.ms}ms)`);

  const s = await req("GET","/api/vitals/status");
  if (s.ok) ok(`vitals/status (${s.ms}ms)`); else warn(`/api/vitals/status -> ${s.status}`);

  const found = await discoverPipeline();
  if (!found) { warn("No pipeline trigger route found"); return; }
  const { m, p, r } = found;
  if (r.ok) ok(`pipeline ${p} (${r.ms}ms)`);
  else {
    console.warn(`• pipeline ${p} -> ${r.status}`);
    if (r.status >= 500) console.warn(`— body —\n${r.text}\n— end —`);
    const hint = hintFrom(r.text || r.ctype); if (hint) console.warn(`• hint: ${hint}`);
  }

  const autoGET = await req("GET","/api/pipeline/auto");
  if (autoGET.ok && autoGET?.json?.running === true) ok("pipeline/auto start");
  const autoDEL = await req("DELETE","/api/pipeline/auto");
  if (autoDEL.ok && autoDEL?.json?.running === false) ok("pipeline/auto stop");
}

async function savingSuite(){
  const found = await discoverPipeline();
  if (found && found.r.ok) ok(`save tick via ${found.p}`); else warn("No successful pipeline trigger, proceeding to DB anyway.");
  await delay(450);
  await withPg(async (db)=>{
    const rows = await db.query(`
      SELECT table_schema||'.'||table_name AS t
      FROM information_schema.tables
      WHERE (table_schema,table_name) IN (('public','dyn_matrix_values'),
                                          ('public','mea_orientations'),
                                          ('public','cin_aux_cycle'),
                                          ('public','cin_aux_session_acc'),
                                          ('strategy_aux','str_aux_session'))
      ORDER BY 1`);
    const existing = new Set(rows.rows.map(x=>x.t));
    const checks = [
      ["public.dyn_matrix_values", `SELECT COUNT(*)::int AS c FROM public.dyn_matrix_values WHERE ts_ms > (EXTRACT(EPOCH FROM now())*1000 - 60*60*1000)`],
      ["public.mea_orientations", `SELECT COUNT(*)::int AS c FROM public.mea_orientations`],
      ["public.cin_aux_cycle", `SELECT COUNT(*)::int AS c FROM public.cin_aux_cycle`],
      ["public.cin_aux_session_acc", `SELECT COUNT(*)::int AS c FROM public.cin_aux_session_acc`],
      ["strategy_aux.str_aux_session", `SELECT COUNT(*)::int AS c FROM strategy_aux.str_aux_session WHERE app_session_id = $1`, [APP_SESSION_ID]],
    ];
    let any = false;
    for (const [name, sql, params] of checks){
      if (!existing.has(name)) { console.warn(`• skip (missing table): ${name}`); continue; }
      const r = await db.query(sql, params||[]);
      const c = r.rows?.[0]?.c ?? 0;
      if (c>0){ ok(`DB ${name} rows > 0 (count=${c})`); any=true; }
      else console.warn(`• DB ${name} has 0 rows`);
    }
    assert(any, "No target table returned rows > 0");
  });
}

function looks(o){ return o && typeof o==="object"; }
async function retrievalSuite(){
  const apis = [
    ["/api/matrices/latest", j => Array.isArray(j) && j.length>0],
    ["/api/matrices/server", j => looks(j)],
    ["/api/cin-aux", j => j!=null],
    ["/api/moo-aux", j => j!=null],
    ["/api/str-aux/latest", j => looks(j) || (Array.isArray(j)&&j.length)],
    ["/api/str-aux/matrix", j => j!=null],
    ["/api/preview/universe/symbols", j => Array.isArray(j)||looks(j)],
  ];
  let anyOK=false;
  for (const [p, pred] of apis){
    const r = await req("GET", p);
    if (r.ok && pred(r.json)) { ok(`GET ${p}`); anyOK=true; }
    else {
      console.warn(`• GET ${p} -> ${r.status}`);
      if (r.status >= 500) console.warn(`— body —\n${r.text}\n— end —`);
      const hint = hintFrom(r.text || r.ctype); if (hint) console.warn(`• hint: ${hint}`);
    }
  }
  assert(anyOK, "No retrieval endpoint returned valid data");
}

(async function main(){
  try{
    if (PIPE_ONLY) { await pipelineSuite(); ok("Doctor pipeline ✓"); return; }
    if (!RET_ONLY) { await pipelineSuite(); if (!NO_DB) await savingSuite(); else warn("Skipping DB checks (--no-db)"); }
    if (!SAVE_ONLY) { await retrievalSuite(); }
    ok("Server Doctor ✓");
  } catch(e) { fail("Server Doctor", e); }
})();

