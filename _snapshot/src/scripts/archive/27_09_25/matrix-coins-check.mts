// Compares coins from session settings vs coins actually persisted at latest benchmark ts.
// Usage: node --import tsx --env-file=.env src/scripts/smokes/matrix-coins-check.mts [--assert]
import { Pool } from "pg";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const APP_SESSION = process.env.APP_SESSION_ID ?? "dev-01";
const ASSERT = process.argv.includes("--assert");

type Json = any;

async function fetchSessionDoc(): Promise<Json | null> {
  try {
    const r = await pool.query(
      `select doc from public.str_aux_session where app_session=$1 order by ts_doc desc limit 1`,
      [APP_SESSION]
    );
    if (r.rows?.[0]?.doc) return r.rows[0].doc;
  } catch {}
  try {
    const r2 = await pool.query(
      `select doc from public.v_str_aux_latest where app_session=$1 limit 1`,
      [APP_SESSION]
    );
    if (r2.rows?.[0]?.doc) return r2.rows[0].doc;
  } catch {}
  return null;
}

function tryArr(x: unknown): string[] | null {
  if (!x) return null;
  if (Array.isArray(x)) return x.map(String);
  return null;
}
function extractCoinsFromDoc(doc: Json): string[] | null {
  const paths = [
    ["settings","matrices","coins"],
    ["settings","grid","coins"],
    ["settings","coins"],
    ["matrices","coins"],
    ["grid","coins"],
    ["coins"]
  ];
  for (const p of paths) {
    let cur: any = doc;
    for (const k of p) cur = cur?.[k];
    const arr = tryArr(cur);
    if (arr && arr.length) return arr.map(s => s.trim().toUpperCase()).filter(Boolean);
  }
  return null;
}

async function latestTs(): Promise<number|null> {
  const { rows } = await pool.query(
    `select max(ts_ms) as ts from dyn_matrix_values where matrix_type='benchmark'`
  );
  return rows?.[0]?.ts ? Number(rows[0].ts) : null;
}

async function persistedCoinsAt(ts: number): Promise<string[]> {
  const { rows } = await pool.query(
    `select base, quote from dyn_matrix_values where matrix_type='benchmark' and ts_ms = $1`,
    [ts]
  );
  const S = new Set<string>();
  for (const r of rows) { if (r.base) S.add(String(r.base)); if (r.quote) S.add(String(r.quote)); }
  return [...S].sort();
}

function setEq(a: string[], b: string[]) {
  if (a.length !== b.length) return false;
  const A = new Set(a), B = new Set(b);
  for (const x of A) if (!B.has(x)) return false;
  return true;
}

(async () => {
  try {
    const doc = await fetchSessionDoc();
    const sessionCoins = (doc && extractCoinsFromDoc(doc)) || [];
    const ts = await latestTs();
    const dbCoins = ts ? await persistedCoinsAt(ts) : [];

    console.log(`[coins-check] session=${APP_SESSION}`);
    console.log("  session coins:", sessionCoins.join(",") || "—");
    console.log("  db coins     :", dbCoins.join(",") || "—");
    console.log("  latest ts    :", ts ?? "—");

    const ok = setEq(
      sessionCoins.map(s=>s.toUpperCase()).sort(),
      dbCoins.map(s=>s.toUpperCase()).sort()
    );

    if (ok) {
      console.log("[coins-check] OK — DB rows reflect session coin set.");
    } else {
      console.log("[coins-check] MISMATCH — DB does not reflect session set.");
      // Show diff
      const S = new Set(sessionCoins), D = new Set(dbCoins);
      const missing = [...S].filter(x => !D.has(x));
      const extra   = [...D].filter(x => !S.has(x));
      if (missing.length) console.log("  missing in DB:", missing.join(","));
      if (extra.length)   console.log("  extra in DB   :", extra.join(","));
      if (ASSERT) process.exit(1);
    }
  } catch (e) {
    console.error("[coins-check] error", e);
    process.exit(2);
  } finally {
    await pool.end();
  }
})();
