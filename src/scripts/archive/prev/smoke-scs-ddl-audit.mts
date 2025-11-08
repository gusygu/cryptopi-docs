// DDL audit + transactional insert probe (no changes to app)
// Run:
//   pnpm smoke:scs:ddl
// Options:
//   --table=public.dyn_matrix_values   (override matrix table)
//   --tsms=1730000000000               (custom ts_ms for probes)
//   --schema=strategy_aux --table2=strategy_aux.str_aux_session  (second table)

import process from "node:process";
import { Client } from "pg";

const DBURL = process.env.DATABASE_URL!;
const ARG = new Map(process.argv.slice(2).map(s => {
  const i = s.indexOf("="); return i>0 ? [s.slice(2,i), s.slice(i+1)] : [s.replace(/^--/,""), "1"];
}) as any);

const MATRIX_TABLE = (ARG.get("table") || process.env.MATRIX_TABLE || "public.dyn_matrix_values").trim();
const STR_TABLE = (ARG.get("table2") || "strategy_aux.str_aux_session").trim();
const TS_MS = Number(ARG.get("tsms") || Date.now());

function ok(m:string){ console.log(`✔ ${m}`); }
function info(m:string){ console.log(`• ${m}`); }
function fail(m:string,e?:unknown){ console.error(`✖ ${m} — ${e instanceof Error? e.message : e}`); }

function splitName(qname:string){ 
  const [schema, table] = qname.includes(".") ? qname.split(".") : ["public", qname];
  return { schema, table };
}

async function auditTable(c:Client, qname:string){
  const { schema, table } = splitName(qname);
  const colSql = `
    SELECT column_name, data_type, is_nullable
    FROM information_schema.columns
    WHERE table_schema=$1 AND table_name=$2
    ORDER BY ordinal_position
  `;
  const idxSql = `
    SELECT i.relname as index_name, pg_get_indexdef(ix.indexrelid) as def
    FROM pg_class t
    JOIN pg_namespace n ON n.oid = t.relnamespace
    JOIN pg_index ix ON t.oid = ix.indrelid
    JOIN pg_class i ON i.oid = ix.indexrelid
    WHERE n.nspname = $1 AND t.relname = $2
    ORDER BY i.relname
  `;
  const cols = (await c.query(colSql, [schema, table])).rows;
  const idxs = (await c.query(idxSql, [schema, table])).rows;

  console.log(`\n=== ${schema}.${table} — columns ===`);
  cols.forEach(r => console.log(`  - ${r.column_name}: ${r.data_type}${r.is_nullable==="NO"?" NOT NULL":""}`));

  console.log(`\n=== ${schema}.${table} — indexes ===`);
  if (idxs.length===0) console.log("  (none)");
  idxs.forEach(r => console.log(`  - ${r.index_name}: ${r.def}`));

  return { cols, idxs };
}

async function probeMatrixInsert(c:Client, qname:string, ts_ms:number){
  const { schema, table } = splitName(qname);
  console.log(`\n--- PROBE: insert into ${schema}.${table} (rolled back) ---`);
  await c.query("BEGIN");
  try{
    const sql = `
      INSERT INTO ${schema}."${table}"
      (matrix_type, base, quote, ts_ms, value)
      VALUES ($1,$2,$3,$4,$5)
      ON CONFLICT (matrix_type, base, quote, ts_ms)
      DO UPDATE SET value=EXCLUDED.value
      RETURNING matrix_type, base, quote, ts_ms, value
    `;
    const params = ["benchmark", "BTC", "USDT", ts_ms, 100.0];
    const res = await c.query(sql, params);
    ok(`probe upsert OK: ${JSON.stringify(res.rows[0])}`);
    await c.query("ROLLBACK"); // don’t leave debris
    return true;
  }catch(e:any){
    fail("probe upsert failed", e);
    await c.query("ROLLBACK");
    return false;
  }
}

async function main(){
  if (!DBURL){ console.error("DATABASE_URL is not set"); process.exit(1); }
  const client = new Client({ connectionString: DBURL });
  await client.connect();
  try{
    info(`DB connect ok. TABLE=${MATRIX_TABLE} TS_MS=${TS_MS}`);

    // 1) audit matrix table
    const { cols, idxs } = await auditTable(client, MATRIX_TABLE);
    // heuristic expectations
    const wantCols = ["matrix_type","base","quote","ts_ms","value"];
    const haveCols = new Set(cols.map((r:any)=>r.column_name));
    const missing = wantCols.filter(c=>!haveCols.has(c));
    if (missing.length) fail(`missing columns on ${MATRIX_TABLE}`, missing.join(", ")); else ok("matrix table has required columns");

    const hasTsBigint = cols.some((r:any)=>r.column_name==="ts_ms" && (r.data_type.includes("bigint") || r.data_type.includes("integer")));
    if (!hasTsBigint) info("note: ts_ms is not bigint/integer; if it is timestamptz, upserts must cast accordingly");

    const wantKey = "(matrix_type, base, quote, ts_ms)";
    const hasConflictKey = idxs.some((r:any)=> String(r.def).includes(wantKey));
    if (!hasConflictKey) info(`note: no unique index exactly on ${wantKey}; ON CONFLICT may fail or hit a different index`);

    // 2) audit strategy table (optional)
    await auditTable(client, STR_TABLE).catch(()=>info(`(skip) cannot read ${STR_TABLE}`));

    // 3) probe upsert (rolled back)
    const okProbe = await probeMatrixInsert(client, MATRIX_TABLE, TS_MS);

    // hints
    console.log("\n=== Hints ===");
    if (!okProbe){
      console.log("- If you saw a type error for ts_ms, ensure it's BIGINT (ms since epoch) or cast in your insert.");
      console.log("- If ON CONFLICT failed, create a unique index on (matrix_type, base, quote, ts_ms).");
      console.log("- If permission error, verify the role from DATABASE_URL can INSERT/UPDATE that table.");
    } else {
      console.log("- DB accepts the canonical row shape. If pipeline still writes 0 rows, the composed grid is likely all null/NaN/diagonal and gets skipped.");
      console.log("- Next step: log the number of finite cells produced before calling upsertMatrixGrid.");
    }

    process.exit(okProbe ? 0 : 1);
  }catch(e){
    fail("ddl audit", e);
    process.exit(1);
  }finally{
    await client.end();
  }
}

main();
