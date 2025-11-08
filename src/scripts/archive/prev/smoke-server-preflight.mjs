// src/scripts/smokes/smoke-server-preflight.mjs
/**
 * Preflight: verify env, DB connect, tables existence, and surface 500 bodies.
 * Usage:
 *   node --env-file=.env src/scripts/smokes/smoke-server-preflight.mjs
 * Flags:
 *   --no-db   skip DB checks
 */
import process from "node:process";

const NO_DB = new Set(process.argv.slice(2)).has("--no-db");
const BASE_URL = (process.env.BASE_URL || "http://localhost:3000").trim();
const DATABASE_URL = (process.env.DATABASE_URL || "").trim();
const APP_SESSION_ID = (process.env.APP_SESSION_ID || "local-dev").trim();

function ok(m){ console.log(`✔ ${m}`); }
function info(m){ console.log(`• ${m}`); }
function fail(m,e){ console.error(`✖ ${m} — ${e?.message||e}`); process.exit(1); }
function assert(c,m){ if(!c) throw new Error(m); }

async function get(path){
  const url = path.startsWith("http") ? path : `${BASE_URL}${path}`;
  const t0 = Date.now();
  const r = await fetch(url, { cache: "no-store" });
  const ctype = r.headers.get("content-type")||"";
  let body = "";
  try { body = await r.text(); } catch {}
  return { ok:r.ok, status:r.status, ms: Date.now()-t0, ctype, body: body?.slice(0,1200), url };
}

async function withPg(fn){
  if (NO_DB) throw new Error("--no-db set");
  let pg; try { pg = await import("pg"); } catch { throw new Error("pg not installed. pnpm add -D pg"); }
  assert(DATABASE_URL, "DATABASE_URL not set");
  const c = new pg.Client({ connectionString: DATABASE_URL });
  await c.connect();
  try { return await fn(c); } finally { await c.end(); }
}

(async function main(){
  try {
    info(`BASE_URL=${BASE_URL}`);
    assert(BASE_URL.startsWith("http"), "BASE_URL must start with http");

    // App reachable?
    const root = await get("/");
    if (!root.ok) {
      console.error(`✖ GET / -> ${root.status} (${root.ms}ms) ctype=${root.ctype}`);
      if (root.status >= 500) console.error(`— 500 body (first 1200 chars) —\n${root.body}\n— end —`);
      throw new Error("Home page not healthy");
    }
    ok(`GET / (${root.ms}ms)`);

    // Health endpoint?
    const h = await get("/api/vitals/health");
    if (!h.ok) {
      console.error(`✖ GET /api/vitals/health -> ${h.status}`);
      if (h.status >= 500) console.error(`— 500 body —\n${h.body}\n— end —`);
      info("If this route doesn't exist, create /api/vitals/health or adjust smokes to your health route.");
    } else ok(`GET /api/vitals/health (${h.ms}ms)`);

    // DB connectivity + tables
    if (!NO_DB) {
      await withPg(async (db) => {
        // quick existence check using information_schema
        const want = [
          ["public","dyn_matrix_values"],
          ["public","mea_orientations"],
          ["public","cin_aux_cycle"],
          ["public","cin_aux_session_acc"],
          ["strategy_aux","str_aux_session"],
        ];
        for (const [schema,table] of want) {
          const q = `
            SELECT 1 FROM information_schema.tables
            WHERE table_schema = $1 AND table_name = $2
            LIMIT 1`;
          const r = await db.query(q, [schema, table]);
          if (r.rowCount === 1) ok(`table exists: ${schema}.${table}`);
          else console.warn(`• MISSING table: ${schema}.${table}`);
        }
      });
    } else info("Skipping DB checks (--no-db).");

    ok("Server preflight ✓");
    process.exit(0);
  } catch(e) {
    fail("Server preflight", e);
  }
})();
