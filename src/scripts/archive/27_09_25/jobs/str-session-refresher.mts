import { Pool } from "pg";
import sessionDb from "@/lib/str-aux/sessionDb";


const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const APP_SESSION = process.env.APP_SESSION_ID ?? "dev-01";

/* ────────────────────────────── coins resolver ───────────────────────────── */

function normalizeCoinsRaw(raw: any): string[] {
  if (raw == null) return [];
  if (typeof raw === "string" && raw.trim().startsWith("[")) {
    try { const a = JSON.parse(raw); if (Array.isArray(a)) raw = a; } catch {}
  }
  const items = Array.isArray(raw) ? raw : String(raw ?? "").split(/[,\s]+/);
  const arr = items.map(x => String(x || "").trim().toUpperCase()).filter(Boolean);
  const uniq = Array.from(new Set(arr));
  if (!uniq.includes("USDT")) uniq.push("USDT");
  return uniq;
}

async function regclassExists(pool: Pool, fqtn: string): Promise<boolean> {
  const { rows } = await pool.query(`SELECT to_regclass($1) IS NOT NULL AS ok`, [fqtn]);
  return !!rows?.[0]?.ok;
}
async function columnExists(pool: Pool, schema: string, table: string, column: string): Promise<boolean> {
  const { rowCount } = await pool.query(
    `SELECT 1 FROM information_schema.columns
      WHERE table_schema=$1 AND table_name=$2 AND column_name=$3`,
    [schema, table, column]
  );
  return rowCount > 0;
}
async function readCoinsFromTable(
  pool: Pool,
  schema: string,
  table: string
): Promise<{ coins: string[]; from: string } | null> {
  const fqtn = `${schema}.${table}`;
  if (!(await regclassExists(pool, fqtn))) return null;

  const hasCoins   = await columnExists(pool, schema, table, "coins");
  const hasDoc     = await columnExists(pool, schema, table, "doc");
  const hasActive  = await columnExists(pool, schema, table, "is_active");
  const hasUpd     = await columnExists(pool, schema, table, "updated_at");
  if (!hasCoins && !hasDoc) return null;

  const coinsExpr = hasCoins ? `coins` : `(doc->>'coins') AS coins`;
  const whereSql  = hasActive ? `WHERE is_active IS TRUE` : ``;
  const orderSql  = hasUpd ? `ORDER BY updated_at DESC` : `ORDER BY 1 DESC`;

  try {
    const { rows } = await pool.query(`SELECT ${coinsExpr} FROM ${fqtn} ${whereSql} ${orderSql} LIMIT 1`);
    const parsed = normalizeCoinsRaw(rows?.[0]?.coins);
    if (parsed.length) return { coins: parsed, from: `settings:${fqtn}` };
  } catch {}
  return null;
}
async function inferCoinsFromSnapshot(pool: Pool): Promise<{ coins: string[]; from: string } | null> {
  const rTs = await pool.query(`SELECT MAX(ts_ms) AS ts FROM public.dyn_matrix_values`);
  const ts  = rTs.rows?.[0]?.ts == null ? null : Number(rTs.rows[0].ts);
  if (!ts) return null;

  const rC = await pool.query(
    `SELECT c FROM (
       SELECT DISTINCT base AS c FROM public.dyn_matrix_values WHERE ts_ms=$1
       UNION ALL
       SELECT DISTINCT quote     FROM public.dyn_matrix_values WHERE ts_ms=$1
     ) u ORDER BY 1`, [ts]
  );
  const inferred = normalizeCoinsRaw(rC.rows.map(x => x.c));
  return inferred.length ? { coins: inferred, from: "snapshot" } : null;
}
async function resolveCoins(pool: Pool): Promise<{ coins: string[]; coins_from: string }> {
  for (const t of ["settings","app_settings","app_config","config"]) {
    const got = await readCoinsFromTable(pool, "public", t);
    if (got) return { coins: got.coins, coins_from: got.from };
  }
  const snap = await inferCoinsFromSnapshot(pool);
  if (snap) return { coins: snap.coins, coins_from: snap.from };

  const envCoins = process.env.COINS || process.env.coins || "";
  const fromEnv  = normalizeCoinsRaw(envCoins);
  if (fromEnv.length) return { coins: fromEnv, coins_from: "env" };

  return { coins: ["BTC","ETH","USDT"], coins_from: "default" };
}

/* ─────────────────────── session/metrics helpers ─────────────────────────── */

type TsByKind  = Record<string, number|null>;
type SrcByKind = Record<string, string|null>;

async function latestMatricesInfo(pool: Pool): Promise<{ ts: TsByKind; src: SrcByKind; snapTs: number|null }> {
  const kinds = ["benchmark","delta","pct24h","id_pct","pct_drv","pct_ref","ref"];
  const ts: TsByKind   = Object.fromEntries(kinds.map(k => [k, null]));
  const src: SrcByKind = Object.fromEntries(kinds.map(k => [k, null]));
  for (const k of kinds) {
    const r = await pool.query(
      `SELECT ts_ms, meta->>'src' AS src
         FROM public.dyn_matrix_values
        WHERE matrix_type=$1
        ORDER BY ts_ms DESC LIMIT 1`, [k]
    );
    const row = r.rows?.[0];
    ts[k]  = row ? Number(row.ts_ms) : null;
    src[k] = row?.src ?? null;
  }
  return { ts, src, snapTs: ts["benchmark"] ?? null };
}

async function etaPctAtLatestIdPct(pool: Pool): Promise<number|null> {
  const r1 = await pool.query(`SELECT MAX(ts_ms) AS ts FROM public.dyn_matrix_values WHERE matrix_type='id_pct'`);
  const ts = r1.rows?.[0]?.ts == null ? null : Number(r1.rows[0].ts);
  if (!ts) return null;
  const r2 = await pool.query(
    `SELECT AVG(ABS(value)) AS eta
       FROM public.dyn_matrix_values
      WHERE matrix_type='id_pct' AND ts_ms=$1`, [ts]
  );
  const eta = r2.rows?.[0]?.eta;
  return eta == null ? null : Number(eta);
}

/* ─────────────────────────── table shape detection ───────────────────────── */

type Shape = {
  table: string;
  idCol: string | null;
  idColType: string | null;
  appSessCol: string | null;
  appSessType: string | null;
  tsCol: string | null;
  docCol: "t_doc" | "doc" | null;
  etaCol: string | null;
  hasUniqueOnId: boolean;
};

function isNumericType(t: string | null): boolean {
  return !!t && /bigint|integer|smallint|numeric|decimal|real|double/i.test(t);
}

// FNV-1a 64-bit -> positive 63-bit bigint (stable)
function hashSessionToBigInt(s: string): bigint {
  let h = 0xcbf29ce484222325n, p = 0x100000001b3n;
  for (let i = 0; i < s.length; i++) { h ^= BigInt(s.charCodeAt(i)); h = (h * p) & 0xffffffffffffffffn; }
  const signed63 = h & 0x7fffffffffffffffn;
  return signed63 === 0n ? 1n : signed63;
}

async function fetchShape(pool: Pool): Promise<Shape> {
  const tableName = "str_aux_session";
  const colsRes = await pool.query(
    `SELECT column_name, data_type
       FROM information_schema.columns
      WHERE table_schema='public' AND table_name=$1`, [tableName]
  );
  const cols = new Map<string,string>();
  for (const r of colsRes.rows ?? []) cols.set(r.column_name, r.data_type);

  const pickFirst = (cands: string[]) => cands.find(c => cols.has(c)) ?? null;
  const idCol      = pickFirst(["id","session_id","key"]);
  const tsCol      = pickFirst(["ts_ms","ts_doc","tsdoc","ts","timestamp_ms"]);
  const docCol     = (["t_doc","doc"].find(c => cols.has(c)) as "t_doc"|"doc"|undefined) ?? null;
  const etaCol     = cols.has("eta_pct") ? "eta_pct" : null;
  const appSessCol = pickFirst(["app_session_id","app_session","session_key","session_label"]);

  const idColType   = idCol ? cols.get(idCol)! : null;
  const appSessType = appSessCol ? cols.get(appSessCol)! : null;

  // detect unique strictly on id
  let hasUniqueOnId = false;
  if (idCol) {
    const idxRes = await pool.query(`
      SELECT ix.indisunique AS unique, array_agg(a.attname ORDER BY a.attnum) AS cols
        FROM pg_class t
        JOIN pg_namespace n ON n.oid=t.relnamespace
        JOIN pg_index ix ON ix.indrelid=t.oid
        JOIN unnest(ix.indkey) WITH ORDINALITY AS k(attnum, ord) ON true
        JOIN pg_attribute a ON a.attrelid=t.oid AND a.attnum=k.attnum
       WHERE n.nspname='public' AND t.relname=$1
       GROUP BY ix.indisunique`, [tableName]
    );
    for (const r of idxRes.rows ?? []) {
      if (r.unique && Array.isArray(r.cols) && r.cols.length === 1 && r.cols[0] === idCol) {
        hasUniqueOnId = true; break;
      }
    }
  }

  console.log("[str-refresh] shape", { idCol, tsCol, docCol, etaCol, hasUniqueOnId, idColType, appSessCol, appSessType });
  return { table: `public.${tableName}`, idCol, idColType, appSessCol, appSessType, tsCol, docCol, etaCol, hasUniqueOnId };
}

/* ───────────────────────────────── main ─────────────────────────────────── */

async function main() {
  const shape = await fetchShape(pool);
  const { idCol, idColType, appSessCol, appSessType, tsCol, docCol, etaCol, table, hasUniqueOnId } = shape;
  if (!idCol || !tsCol) throw new Error("str_aux_session schema needs an id column and a ts column.");

  // identifiers
  const idIsNumeric      = isNumericType(idColType);
  const idValueStr       = idIsNumeric ? hashSessionToBigInt(APP_SESSION).toString() : APP_SESSION;
  const idCast           =
    idColType?.includes("bigint")  ? "::bigint"  :
    idColType?.includes("integer") ? "::integer" : "";

  const appSessIsNumeric = isNumericType(appSessType);
  const appSessValueStr  = appSessCol
    ? (appSessIsNumeric ? hashSessionToBigInt(APP_SESSION).toString() : APP_SESSION)
    : null;
  const appSessCast      =
    appSessType?.includes("bigint")  ? "::bigint"  :
    appSessType?.includes("integer") ? "::integer" : "";

  const { coins, coins_from } = await resolveCoins(pool);
  const { ts, src, snapTs }   = await latestMatricesInfo(pool);
  const eta_pct               = await etaPctAtLatestIdPct(pool);
  const now                   = Date.now();

  const payload = {
    app_session: APP_SESSION,
    now,
    coins,
    matrices: { coins_from, coins, ts, src, snap_ts: snapTs },
    mea: { cycle_ts: (await pool.query(`SELECT MAX(cycle_ts) AS ts FROM public.mea_orientations`)).rows?.[0]?.ts ?? null },
    cin: { cycle_ts: (await pool.query(`SELECT MAX(cycle_ts) AS ts FROM public.cin_aux_cycle`)).rows?.[0]?.ts ?? null },
  };

  // UPDATE
  const setParts: string[] = [];
  const vals: any[] = [];
  vals.push(idValueStr);                                     // $1 = id in WHERE

  setParts.push(`${tsCol}=$${vals.length + 1}`);             vals.push(now);
  if (docCol)     { setParts.push(`${docCol}=$${vals.length + 1}::jsonb`); vals.push(JSON.stringify(payload)); }
  if (etaCol)     { setParts.push(`${etaCol}=$${vals.length + 1}`);         vals.push(eta_pct); }
  if (appSessCol) { setParts.push(`${appSessCol}=$${vals.length + 1}${appSessCast}`); vals.push(appSessValueStr); }

  const updSQL = `UPDATE ${table} SET ${setParts.join(", ")} WHERE ${idCol}=$1${idCast}`;
  const upd = await pool.query(updSQL, vals);

  // INSERT if no row was updated
  if (upd.rowCount === 0) {
    const cols: string[] = [idCol, tsCol];
    const ph:   string[] = [`$1${idCast}`, "$2"];
    const insVals: any[] = [idValueStr, now];

    let next = 2;
    if (docCol)     { cols.push(docCol);     ph.push(`$${++next}::jsonb`); insVals.push(JSON.stringify(payload)); }
    if (etaCol)     { cols.push(etaCol);     ph.push(`$${++next}`);         insVals.push(eta_pct); }
    if (appSessCol) { cols.push(appSessCol); ph.push(`$${++next}${appSessCast}`); insVals.push(appSessValueStr); }

    const onConflict = hasUniqueOnId ? `ON CONFLICT (${idCol}) DO NOTHING` : ``;
    const insSQL = `INSERT INTO ${table} (${cols.join(", ")}) VALUES (${ph.join(", ")}) ${onConflict}`;
    await pool.query(insSQL, insVals);

    if (!hasUniqueOnId) await pool.query(updSQL, vals); // idempotent upsert
  }

  console.log(
    "[str-refresh] session upsert",
    "id=", idValueStr,
    "idType=", idColType ?? "—",
    "appSessCol=", appSessCol ?? "—",
    "tsCol=", tsCol,
    "docCol=", docCol ?? "—",
    "etaCol=", etaCol ?? "—",
    "snap_ts=", snapTs ?? "—",
    "eta_pct=", eta_pct ?? "—",
    "coins=", coins.join(","),
    "coins_from=", coins_from
  );
}

main().catch(e => { console.error("[str-refresh] error", e); process.exit(1); });
