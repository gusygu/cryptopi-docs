// src/scripts/smokes/smoke-scs-write-trace.mts
import process from "node:process";
import path from "node:path";
import url from "node:url";
import { Client } from "pg";

const MATRIX_TABLE = (process.env.MATRIX_TABLE || "public.dyn_matrix_values").trim();
const TYPE  = (process.argv.find(a=>a.startsWith("--type="))?.split("=")[1] || "benchmark");
const BASES = (process.argv.find(a=>a.startsWith("--bases="))?.split("=")[1] || "BTC,ETH")
  .split(/[,\s]+/)                 // accept comma or spaces
  .map(s=>s.trim().toUpperCase())
  .filter(Boolean);
const QUOTE = (process.argv.find(a=>a.startsWith("--quote="))?.split("=")[1] || "USDT").trim().toUpperCase();
const TS_MS = Number(process.argv.find(a=>a.startsWith("--ts="))?.split("=")[1] || Date.now());

function ok(m:string){ console.log(`✔ ${m}`); }
function info(m:string){ console.log(`• ${m}`); }
function fail(m:string,e?:unknown){ console.error(`✖ ${m}${e?` — ${(e as any)?.message||e}`:""}`); process.exit(1); }

function resolveAlias(p:string){
  const root = process.cwd();
  if (p.startsWith("@/")) return path.join(root,"src",p.slice(2));
  if (p.startsWith("src/")||p.startsWith("./src/")) return path.join(root,p.replace(/^\.\//,""));
  return path.isAbsolute(p)?p:path.join(root,p);
}

function buildGrid(bases:string[], quote:string): (number|null)[][] {
  // mock deterministic prices; ensures finite off-diagonals
  const prices: Record<string, number> = {};
  bases.forEach((b,i)=>{ prices[`${b}${quote}`] = 1000 + (i+1)*10; });
  return bases.map((bi,i)=> bases.map((bj,j)=>{
    if (i===j) return 0;
    const vi = prices[`${bi}${quote}`], vj = prices[`${bj}${quote}`];
    const v = vi/vj;
    return Number.isFinite(v) ? v : null;
  }));
}

async function countAt(client: Client, table: string, type: string, ts: number){
  const [schema, name] = table.includes(".") ? table.split(".") : ["public", table];
  const sql = `SELECT COUNT(*)::int AS c FROM ${schema}."${name}" WHERE matrix_type=$1 AND ts_ms=$2`;
  const r = await client.query(sql, [type, ts]);
  return r.rows?.[0]?.c ?? 0;
}
async function selectSample(client: Client, table:string, type:string, ts:number){
  const [schema, name] = table.includes(".") ? table.split(".") : ["public", table];
  const r = await client.query(
    `SELECT matrix_type, base, quote, ts_ms, value
     FROM ${schema}."${name}"
     WHERE matrix_type=$1 AND ts_ms=$2
     ORDER BY base, quote
     LIMIT 5`, [type, ts]
  );
  return r.rows || [];
}

(async function main(){
  if (!process.env.DATABASE_URL){ fail("DATABASE_URL not set"); }
  const c1 = new Client({ connectionString: process.env.DATABASE_URL }); await c1.connect();
  const c2 = new Client({ connectionString: process.env.DATABASE_URL }); await c2.connect();

  try{
    info(`TABLE=${MATRIX_TABLE} TYPE=${TYPE} BASES=${BASES.join(",")} QUOTE=${QUOTE} TS_MS=${TS_MS}`);

    const before1 = await countAt(c1, MATRIX_TABLE, TYPE, TS_MS);
    const before2 = await countAt(c2, MATRIX_TABLE, TYPE, TS_MS);
    info(`count before (conn1)=${before1} (conn2)=${before2}`);

    // call your real saver
    const modDB = await import(url.pathToFileURL(resolveAlias("@/core/pipelines/pipeline.db.ts")).href);
    const upsertMatrixGrid = modDB?.upsertMatrixGrid;
    if (typeof upsertMatrixGrid !== "function") fail("upsertMatrixGrid export not found");
    const grid = buildGrid(BASES, QUOTE);
    const finite = grid.flat().filter(v=>typeof v==="number" && Number.isFinite(v) && v!==0).length;
    info(`grid finite off-diagonal cells=${finite}`);
    const res = await upsertMatrixGrid(TYPE, BASES, QUOTE, grid, TS_MS);
    info(`upsertMatrixGrid result: ${res!==undefined ? JSON.stringify(res).slice(0,200) : "void"}`);

    // give the pool a moment to flush
    await new Promise(r => setTimeout(r, 100));

    const after1 = await countAt(c1, MATRIX_TABLE, TYPE, TS_MS);
    const after2 = await countAt(c2, MATRIX_TABLE, TYPE, TS_MS);
    const delta1 = after1 - before1;
    const delta2 = after2 - before2;

    ok(`count after (conn1)=${after1} Δ=${delta1}; (conn2)=${after2} Δ=${delta2}`);

    if (after1 <= before1 && after2 <= before2) {
      const sample = await selectSample(c1, MATRIX_TABLE, TYPE, TS_MS);
      info(`sample rows: ${JSON.stringify(sample)}`);
      fail("no new rows observed — likely saver filtered rows or wrote to a different table/schema");
    } else {
      const sample = await selectSample(c1, MATRIX_TABLE, TYPE, TS_MS);
      ok(`sample rows: ${JSON.stringify(sample)}`);
      process.exit(0);
    }
  } catch(e){ fail("write-trace", e); }
  finally { await c1.end(); await c2.end(); }
})();
