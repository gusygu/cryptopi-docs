// Compact DB scan
// Run: node --env-file=.env src/scripts/smokes/diagnostics/diag-db-scan.mjs
import { Client } from "pg";

const DB_URL = process.env.DATABASE_URL;
if (!DB_URL) { console.error("✖ DATABASE_URL not set"); process.exit(1); }

const COMPACT = process.env.SMOKE_COMPACT !== "0";
const MAX_ROWS = COMPACT ? 6 : 20;
const MAX_STR = COMPACT ? 80 : 400;
const NUM_PREC = COMPACT ? 6 : 12;

const CANDIDATE_TABLES = [
  "public.dyn_matrix_values",
  "strategy_aux.str_aux_session",
  "public.app_sessions",
  "public.session_openings",
  "public.app_ledger",
  "public.transfer_ledger",
  "public.v_transfer_ledger_rollup",
  "public.cin_aux_session_acc",
  "public.cin_aux_cycle",
  "public.cin_flow_ledger",
  "public.cin_metrics",
  "public.legs",
  "public.sym_flow",
  "public.sym_profit",
  "public.mea_aux_snapshots",
  "public.reference_list",
  "public.reference_prev",
  "public.reference_next",
  "public.reference_nearest",
  "public.reference_prefs",
  "public.cycles",
  "public.snapshots",
];

const ORDER_PREFS = ["ts_ms","created_at","updated_at","ts","id","pk"];

const roundNum = (v) =>
  typeof v === "number" && Number.isFinite(v)
    ? Number(v.toPrecision(NUM_PREC))
    : v;

const trimVal = (v) => {
  if (v == null) return v;
  if (typeof v === "string") {
    return v.length > MAX_STR ? v.slice(0, MAX_STR) + "…" : v;
  }
  if (typeof v === "number") return roundNum(v);
  if (Array.isArray(v)) return v.slice(0, 8).map(trimVal);
  if (typeof v === "object") {
    const out = {};
    for (const k of Object.keys(v).slice(0, 12)) out[k] = trimVal(v[k]);
    return out;
  }
  return v;
};

async function tableExists(client, fq) {
  const [schema, table] = fq.includes(".") ? fq.split(".") : ["public", fq];
  const q = `select 1 from information_schema.tables where table_schema=$1 and table_name=$2 limit 1`;
  const r = await client.query(q, [schema, table.replace(/"/g, "")]);
  return r.rowCount > 0;
}

async function getColumns(client, fq) {
  const [schema, table] = fq.includes(".") ? fq.split(".") : ["public", fq];
  const q = `select column_name from information_schema.columns where table_schema=$1 and table_name=$2 order by ordinal_position`;
  const r = await client.query(q, [schema, table.replace(/"/g, "")]);
  return r.rows.map((x) => x.column_name);
}

const pickOrder = (cols) => ORDER_PREFS.find((p) => cols.includes(p)) || cols[0] || "1";

async function scanTable(client, fq) {
  const cols = await getColumns(client, fq);
  const orderCol = pickOrder(cols);
  const cnt = Number((await client.query(`select count(*)::bigint n from ${fq}`)).rows[0].n);

  let sample = [];
  if (cnt > 0) {
    const sel = cols.map((c) => `"${c}"`).join(", ");
    const r = await client.query(
      `select ${sel} from ${fq} order by "${orderCol}" desc limit ${MAX_ROWS}`
    );
    sample = r.rows.map((row) => {
      const out = {};
      // In compact mode, keep up to 10 columns; always include order column if present
      const keepCols = new Set(cols.slice(0, COMPACT ? 10 : cols.length));
      keepCols.add(orderCol);
      for (const c of cols) {
        if (!keepCols.has(c)) continue;
        out[c] = trimVal(row[c]);
      }
      return out;
    });
  }

  const entry = { t: fq, n: cnt, by: orderCol, rows: sample };
  if (!COMPACT) entry.columns = cols;
  return entry;
}

(async () => {
  const client = new Client({ connectionString: DB_URL });
  await client.connect();
  const out = {
    at: new Date().toISOString(),
    compact: COMPACT,
    tables: [],
  };
  for (const t of CANDIDATE_TABLES) {
    try {
      if (!(await tableExists(client, t))) { out.tables.push({ t, x: false }); continue; }
      out.tables.push(await scanTable(client, t));
    } catch (e) {
      out.tables.push({ t, err: String(e?.message || e) });
    }
  }
  await client.end();
  console.log(JSON.stringify(out));
})().catch((e) => { console.error(e); process.exit(1); });
