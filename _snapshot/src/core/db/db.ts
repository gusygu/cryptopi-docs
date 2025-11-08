// src/core/db/db.ts
import type { PoolClient, QueryResult, QueryResultRow } from "pg";
import { db, getPool, query, withClient } from "./pool_server";

export { db, getPool, query, withClient } from "./pool_server";

/** ------- Dynamics matrices (kept signatures) ------- */
// Optional env override; defaults to our canonical table
const RAW_TABLE = process.env.MATRIX_TABLE || "matrices.dyn_values";

// Prevent SQL injection on identifier
function asIdent(name: string) {
  const parts = String(name).split(".").filter(Boolean);
  if (!parts.length) throw new Error(`Invalid table identifier: ${name}`);
  return parts.map((part) => {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(part)) {
      throw new Error(`Invalid table identifier: ${name}`);
    }
    return `"${part}"`;
  }).join(".");
}
const TABLE = asIdent(RAW_TABLE);

const RAW_STAGE_TABLE =
  process.env.MATRIX_STAGE_TABLE || "matrices.dyn_values_stage";
const RAW_COMMIT_TABLE =
  process.env.MATRIX_COMMIT_TABLE ||
  process.env.MATRIX_TABLE ||
  "matrices.dyn_values";

const STAGE_TABLE_CANDIDATES = Array.from(
  new Set(
    [
      process.env.MATRIX_STAGE_TABLE,
      "matrices.dyn_values_stage",
      "public.dyn_matrix_values_stage",
    ].filter(Boolean) as string[]
  )
);

const MATRIX_TABLE_CANDIDATES = Array.from(
  new Set(
    [
      process.env.MATRIX_COMMIT_TABLE,
      process.env.MATRIX_TABLE,
      "matrices.dyn_values",
      "public.dyn_matrix_values",
    ].filter(Boolean) as string[]
  )
);

type RelationInfo = { raw: string; ident: string; kind: string };

function splitQualifiedName(name: string): { schema: string; relation: string } {
  const parts = String(name).split(".");
  if (parts.length === 1) return { schema: "public", relation: parts[0]! };
  const relation = parts.pop()!;
  return { schema: parts.join("."), relation };
}

async function ensureMatrixTables(client: PoolClient) {
  await client.query(`CREATE SCHEMA IF NOT EXISTS matrices`);
  await client.query(`
    DO $$
    BEGIN
      IF EXISTS (
        SELECT 1
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'matrices'
          AND c.relname = 'dyn_values'
          AND c.relkind IN ('v','m')
      ) THEN
        EXECUTE 'DROP VIEW IF EXISTS matrices.dyn_values CASCADE';
      END IF;
      IF EXISTS (
        SELECT 1
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'matrices'
          AND c.relname = 'dyn_values_stage'
          AND c.relkind IN ('v','m')
      ) THEN
        EXECUTE 'DROP VIEW IF EXISTS matrices.dyn_values_stage CASCADE';
      END IF;
    END
    $$;
  `);
  await client.query(`
    CREATE TABLE IF NOT EXISTS matrices.dyn_values (
      ts_ms        bigint           NOT NULL,
      matrix_type  text             NOT NULL CHECK (matrix_type IN ('benchmark','delta','pct24h','id_pct','pct_drv','ref','pct_ref')),
      base         text             NOT NULL,
      quote        text             NOT NULL,
      value        double precision NOT NULL,
      meta         jsonb            NOT NULL DEFAULT '{}'::jsonb,
      created_at   timestamptz      NOT NULL DEFAULT now(),
      PRIMARY KEY (ts_ms, matrix_type, base, quote)
    )
  `);
  await client.query(`
    CREATE INDEX IF NOT EXISTS idx_matrices_dyn_values_pair
      ON matrices.dyn_values (matrix_type, base, quote, ts_ms DESC)
  `);
  await client.query(`
    CREATE TABLE IF NOT EXISTS matrices.dyn_values_stage (
      ts_ms         bigint           NOT NULL,
      matrix_type   text             NOT NULL,
      base          text             NOT NULL,
      quote         text             NOT NULL,
      value         double precision NOT NULL,
      meta          jsonb            NOT NULL DEFAULT '{}'::jsonb,
      app_session_id text,
      created_at    timestamptz      NOT NULL DEFAULT now(),
      PRIMARY KEY (ts_ms, matrix_type, base, quote)
    )
  `);
}

async function findExistingTable(
  client: PoolClient,
  candidates: string[]
): Promise<RelationInfo | null> {
  for (const raw of candidates) {
    const { schema, relation } = splitQualifiedName(raw);
    const { rows } = await client.query<{ kind?: string }>(
      `
        SELECT c.relkind AS kind
          FROM pg_class c
          JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE n.nspname = $1 AND c.relname = $2
      `,
      [schema, relation]
    );
    const kind = rows[0]?.kind;
    if (kind && (kind === "r" || kind === "p")) {
      return { raw, ident: asIdent(raw), kind };
    }
  }
  return null;
}

let cachedStageInfo: RelationInfo | null = null;
let cachedMatrixInfo: RelationInfo | null = null;

async function ensureStageInfo(client: PoolClient): Promise<RelationInfo> {
  if (cachedStageInfo) return cachedStageInfo;
  let info =
    (await findExistingTable(client, [RAW_STAGE_TABLE, ...STAGE_TABLE_CANDIDATES])) ??
    (await findExistingTable(client, STAGE_TABLE_CANDIDATES));
  if (!info) {
    await ensureMatrixTables(client);
    info =
      (await findExistingTable(client, [RAW_STAGE_TABLE, ...STAGE_TABLE_CANDIDATES])) ??
      (await findExistingTable(client, STAGE_TABLE_CANDIDATES));
    if (!info) {
      throw new Error(
        `Matrix stage table not found. Checked: ${[
          RAW_STAGE_TABLE,
          ...STAGE_TABLE_CANDIDATES,
        ]
          .filter(Boolean)
          .join(", ")}`
      );
    }
  }
  cachedStageInfo = info;
  return info;
}

async function ensureMatrixInfo(client: PoolClient): Promise<RelationInfo> {
  if (cachedMatrixInfo) return cachedMatrixInfo;
  let info =
    (await findExistingTable(client, [RAW_COMMIT_TABLE, ...MATRIX_TABLE_CANDIDATES])) ??
    (await findExistingTable(client, MATRIX_TABLE_CANDIDATES));
  if (!info) {
    await ensureMatrixTables(client);
    info =
      (await findExistingTable(client, [RAW_COMMIT_TABLE, ...MATRIX_TABLE_CANDIDATES])) ??
      (await findExistingTable(client, MATRIX_TABLE_CANDIDATES));
    if (!info) {
      throw new Error(
        `Matrix values table not found. Checked: ${[
          RAW_COMMIT_TABLE,
          ...MATRIX_TABLE_CANDIDATES,
        ]
          .filter(Boolean)
          .join(", ")}`
      );
    }
  }
  if (!info) {
    throw new Error(
      `Matrix values table not found. Checked: ${[
        RAW_COMMIT_TABLE,
        ...MATRIX_TABLE_CANDIDATES,
      ]
        .filter(Boolean)
        .join(", ")}`
    );
  }
  cachedMatrixInfo = info;
  return info;
}

function dedupeUpper(xs: readonly string[] | undefined | null): string[] {
  if (!xs?.length) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const x of xs) {
    const up = String(x ?? "").trim().toUpperCase();
    if (!up || seen.has(up)) continue;
    seen.add(up);
    out.push(up);
  }
  return out;
}

export async function getMatrixStageTableIdent(
  client?: PoolClient
): Promise<string> {
  if (cachedStageInfo) return cachedStageInfo.ident;
  const useClient = client ?? (await db.connect());
  const release = !client;
  try {
    const info = await ensureStageInfo(useClient);
    return info.ident;
  } finally {
    if (release) useClient.release();
  }
}

async function getMatrixValuesTableIdent(
  client: PoolClient
): Promise<string> {
  const info = await ensureMatrixInfo(client);
  return info.ident;
}

/** Matrix type union (aligns with DDL) */
export type MatrixType = "benchmark" | "delta" | "pct24h" | "id_pct" | "pct_drv" | "ref" | "pct_ref";

/** Bulk upsert directly into main table (bypasses stage/commit) */
export async function upsertMatrixRows(rows: {
  ts_ms: number;
  matrix_type: MatrixType;
  base: string; quote: string; value: number;
  meta?: Record<string, any>;
}[]) {
  if (!rows.length) return;
  const client = await db.connect();
  try {
    const values: any[] = [];
    const chunks = rows.map((r, i) => {
      const j = i * 6;
      values.push(r.ts_ms, r.matrix_type, r.base, r.quote, r.value, JSON.stringify(r.meta ?? {}));
      return `($${j+1}, $${j+2}, $${j+3}, $${j+4}, $${j+5}, $${j+6})`;
    }).join(",");

    const sql = `
      INSERT INTO ${TABLE} (ts_ms, matrix_type, base, quote, value, meta)
      VALUES ${chunks}
      ON CONFLICT (ts_ms, matrix_type, base, quote)
      DO UPDATE SET value = EXCLUDED.value, meta = EXCLUDED.meta;
    `;
    await client.query(sql, values);
  } finally {
    client.release();
  }
}

/** Snapshots & lookups */
export async function getLatestByType(matrix_type: string, coins: string[]) {
  const client = await db.connect();
  try {
    const { rows } = await client.query(
      `SELECT ts_ms FROM ${TABLE} WHERE matrix_type=$1 ORDER BY ts_ms DESC LIMIT 1`,
      [matrix_type]
    );
    if (!rows.length) return { ts_ms: null, values: [] as any[] };
    const ts_ms = Number(rows[0].ts_ms);
    const { rows: vals } = await client.query(
      `SELECT base, quote, value FROM ${TABLE}
       WHERE matrix_type=$1 AND ts_ms=$2 AND base = ANY($3) AND quote = ANY($3)`,
      [matrix_type, ts_ms, coins]
    );
    return { ts_ms, values: vals };
  } finally { client.release(); }
}

export async function getPrevValue(matrix_type: string, base: string, quote: string, beforeTs: number) {
  const { rows } = await db.query(
    `SELECT value FROM ${TABLE}
     WHERE matrix_type=$1 AND base=$2 AND quote=$3 AND ts_ms < $4
     ORDER BY ts_ms DESC LIMIT 1`,
    [matrix_type, base, quote, beforeTs]
  );
  return rows.length ? Number(rows[0].value) : null;
}

export async function getLatestTsForType(matrix_type: string) {
  const { rows } = await db.query(
    `SELECT MAX(ts_ms) AS ts_ms FROM ${TABLE} WHERE matrix_type=$1`,
    [matrix_type]
  );
  const v = rows[0]?.ts_ms;
  return v == null ? null : Number(v);
}

export async function getNearestTsAtOrBefore(matrix_type: string, ts_ms: number) {
  const { rows } = await db.query(
    `SELECT ts_ms FROM ${TABLE}
     WHERE matrix_type=$1 AND ts_ms <= $2
     ORDER BY ts_ms DESC LIMIT 1`,
    [matrix_type, ts_ms]
  );
  const v = rows[0]?.ts_ms;
  return v == null ? null : Number(v);
}

export async function getSnapshotByType(matrix_type: string, ts_ms: number, coins: string[]) {
  const { rows } = await db.query(
    `SELECT base, quote, value FROM ${TABLE}
     WHERE matrix_type=$1 AND ts_ms=$2 AND base = ANY($3) AND quote = ANY($3)`,
    [matrix_type, ts_ms, coins]
  );
  return rows as { base:string; quote:string; value:number }[];
}

export async function getPrevSnapshotByType(matrix_type: string, beforeTs: number, coins: string[]) {
  const { rows } = await db.query(
    `SELECT DISTINCT ON (base, quote) base, quote, value
       FROM ${TABLE}
      WHERE matrix_type=$1
        AND ts_ms < $2
        AND base  = ANY($3)
        AND quote = ANY($3)
   ORDER BY base, quote, ts_ms DESC`,
    [matrix_type, beforeTs, coins]
  );
  return rows as { base: string; quote: string; value: number }[];
}

export async function countRowsAt(matrix_type: string, ts_ms: number) {
  const { rows } = await db.query(
    `SELECT count(*)::int AS n FROM ${TABLE} WHERE matrix_type=$1 AND ts_ms=$2`,
    [matrix_type, ts_ms]
  );
  return rows[0]?.n ?? 0;
}


// ───────────────────────── Opening helpers (DB + cache) ──────────────────────
type OpeningKey = { base: string; quote?: string; window?: string; appSessionId?: string };
const openingCache = new Map<string, { price: number; ts: number }>();
const keyStr = (k: OpeningKey) =>
  `${k.base}:${k.quote ?? "USDT"}:${k.window ?? "1h"}:${k.appSessionId ?? "global"}`;

/** Read last opening for a (base,quote,window,session) from STR-AUX; fallback to compat view */
export async function getOpeningFromDb(
  k: OpeningKey
): Promise<{ price: number; ts: number } | null> {
  // Source of truth: strategy_aux.str_aux_session with opening_stamp = TRUE
  const q1 = `
    SELECT opening_ts AS ts, opening_price AS price
      FROM strategy_aux.str_aux_session
     WHERE pair_base=$1 AND pair_quote=$2 AND window_key=$3
       AND ($4::text IS NULL OR app_session_id=$4)
       AND opening_stamp = TRUE
  ORDER BY opening_ts DESC
     LIMIT 1
  `;
  const r1 = await db.query(q1, [k.base, k.quote ?? "USDT", k.window ?? "1h", k.appSessionId ?? null]);
  if (r1.rows.length) {
    return { price: Number(r1.rows[0].price), ts: Number(r1.rows[0].ts) };
  }

  // Compatibility view (kept for older code paths)
  const q2 = `SELECT session_ts AS ts, opening_price AS price
                FROM session_openings
            ORDER BY session_ts DESC
               LIMIT 1`;
  const r2 = await db.query(q2);
  if (r2.rows.length) {
    return { price: Number(r2.rows[0].price), ts: Number(r2.rows[0].ts) };
  }
  return null;
}

/**
 * Ensure an opening exists + cache it for this process.
 * If you pass openingTs/openingPrice, we try to upsert via the SQL function `upsert_str_aux_opening` (if present).
 */
export async function ensureOpening(
  k: OpeningKey,
  opts: { openingTs?: number; openingPrice?: number; etaPct?: number; epsShiftPct?: number; K?: number } = {}
) {
  const ck = keyStr(k);
  const hit = openingCache.get(ck);
  if (hit) return hit;

  // If given explicit opening, try to persist (no-op if the function doesn't exist).
  if (opts.openingPrice != null && opts.openingTs != null) {
    try {
      await db.query(
        `SELECT upsert_str_aux_opening($1,$2,$3,$4,$5,$6,$7)`,
        [
          k.base, k.quote ?? "USDT", k.window ?? "1h", k.appSessionId ?? "global",
          opts.openingTs, opts.openingPrice,
          `idem:${k.base}:${k.quote ?? "USDT"}:${k.window ?? "1h"}:${k.appSessionId ?? "global"}:${opts.openingTs}`
        ]
      );
    } catch { /* function may not exist yet; it's fine */ }
  }

  const row = await getOpeningFromDb(k);
  if (row) {
    openingCache.set(ck, row);
    return row;
  }
  return null;
}

export function clearOpeningCache(k?: OpeningKey) {
  if (!k) return openingCache.clear();
  openingCache.delete(keyStr(k));
}


// ───────────────────────── Matrices STAGE/COMMIT helpers ─────────────────────
/** Grid object shape used across features (BASE -> QUOTE -> value|null) */
export type MatrixGridObject = Record<string, Record<string, number | null>>;

/** Internal: iterate off-diagonal cells that have finite numbers */
function* cellsOf(coins: string[], values: MatrixGridObject) {
  for (const b of coins) {
    for (const q of coins) {
      if (b === q) continue;
      const v = values?.[b]?.[q];
      if (v == null || Number.isNaN(Number(v))) continue;
      yield { base: b, quote: q, value: Number(v) };
    }
  }
}

/** Stage all cells for a (matrix_type, ts_ms). Overwrites on conflict in STAGE. */
export async function stageMatrixGrid(opts: {
  appSessionId: string;
  matrixType: MatrixType;
  tsMs: number;
  coins: string[];
  values: MatrixGridObject;
  meta?: any;
  client?: PoolClient;
}) {
  const { appSessionId, matrixType, tsMs, coins, values, meta, client: external } =
    opts;
  const client = external ?? (await db.connect());
  const release = !external;
  try {
    const rows = Array.from(cellsOf(coins, values));
    if (!rows.length) return { ok: true, staged: 0 };

    const metaJson = JSON.stringify(meta ?? {});
    const stageInfo = await ensureStageInfo(client);
    const text = `
      INSERT INTO ${stageInfo.ident}
        (ts_ms, matrix_type, base, quote, value, meta, app_session_id)
      VALUES ${rows
        .map(
          (_, i) =>
            `($1,$2,$${i * 3 + 3},$${i * 3 + 4},$${i * 3 + 5},$${
              rows.length * 3 + 3
            },$${rows.length * 3 + 4})`
        )
        .join(",")}
      ON CONFLICT (ts_ms, matrix_type, base, quote)
      DO UPDATE SET value = EXCLUDED.value, meta = EXCLUDED.meta, app_session_id = EXCLUDED.app_session_id
    `;
    const params: any[] = [tsMs, matrixType];
    for (const r of rows) params.push(r.base, r.quote, r.value);
    params.push(metaJson, appSessionId);
    await client.query(text, params);
    return { ok: true, staged: rows.length };
  } finally {
    if (release) client.release();
  }
}

/** Publish staged rows into main table + cycle_document + ledger (see DDL) */
export async function commitMatrixGrid(opts: {
  appSessionId: string;
  matrixType: MatrixType;
  tsMs: number;
  coins?: string[];
  idem?: string | null;
  client?: PoolClient;
}) {
  const { matrixType, tsMs, coins, client: external } = opts;
  const client = external ?? (await db.connect());
  const release = !external;
  const manageTx = !external;
  try {
    if (manageTx) await client.query("BEGIN");

    const stageInfo = await ensureStageInfo(client);
    const matrixTable = await getMatrixValuesTableIdent(client);

    const stageRows = await client.query<{ base: string; quote: string }>(
      `SELECT base, quote
         FROM ${stageInfo.ident}
        WHERE ts_ms = $1 AND matrix_type = $2`,
      [tsMs, matrixType]
    );

    const stagedCells = stageRows.rowCount ?? stageRows.rows.length;

    const coinsFromStage = new Set<string>();
    for (const row of stageRows.rows) {
      const base = String(row.base ?? "").toUpperCase();
      const quote = String(row.quote ?? "").toUpperCase();
      if (base) coinsFromStage.add(base);
      if (quote) coinsFromStage.add(quote);
    }

    const eligibleCoins =
      coins?.length && dedupeUpper(coins).length
        ? dedupeUpper(coins)
        : Array.from(coinsFromStage);

    const expectedCells =
      eligibleCoins.length * Math.max(eligibleCoins.length - 1, 0);

    await client.query(
      `
      INSERT INTO ${matrixTable}
        (ts_ms, matrix_type, base, quote, value, meta)
      SELECT ts_ms, matrix_type, base, quote, value, meta
        FROM ${stageInfo.ident}
       WHERE ts_ms = $1 AND matrix_type = $2
      ON CONFLICT (ts_ms, matrix_type, base, quote)
      DO UPDATE SET value = EXCLUDED.value, meta = EXCLUDED.meta
    `,
      [tsMs, matrixType]
    );

    const stagedPairs = new Set(
      stageRows.rows
        .map((row) => {
          const base = String(row.base ?? "").toUpperCase();
          const quote = String(row.quote ?? "").toUpperCase();
          if (!base || !quote || base === quote) return null;
          return `${base}→${quote}`;
        })
        .filter(Boolean) as string[]
    );

    let missingCount = 0;
    for (const base of eligibleCoins) {
      for (const quote of eligibleCoins) {
        if (base === quote) continue;
        if (!stagedPairs.has(`${base}→${quote}`)) missingCount += 1;
      }
    }

    if (manageTx) await client.query("COMMIT");

    return {
      ok: true,
      matrix_type: matrixType,
      ts_ms: tsMs,
      expected_cells: expectedCells,
      staged_cells: stagedCells,
      missing_count: missingCount,
      complete: missingCount === 0 && stagedCells === expectedCells,
    };
  } catch (err) {
    if (manageTx) await client.query("ROLLBACK");
    throw err;
  } finally {
    if (release) client.release();
  }
}

/** Convenience: read prev benchmark grid for a coin set (paired map) */
async function mapPrevBenchmark(beforeTs: number, coins: string[]) {
  const prev = await getPrevSnapshotByType("benchmark", beforeTs, coins);
  const m = new Map<string, number>();
  for (const r of prev) m.set(`${r.base}/${r.quote}`, Number(r.value));
  return m;
}

/**
 * Persist the current live slices for the active coin-universe:
 *  - benchmark (full N×N)
 *  - pct24h   (as-is from live)
 *  - id_pct   (derived vs prev benchmark so pct_drv has history on next tick)
 *
 * All three use the SAME ts_ms to keep slices aligned.
 */
export async function persistLiveMatricesSlice(opts: {
  appSessionId: string;
  coins: string[];
  tsMs: number;
  benchmark: MatrixGridObject;
  pct24h?: MatrixGridObject;
  idemPrefix?: string;
}) {
  const { appSessionId, coins, tsMs, benchmark, pct24h, idemPrefix } = opts;

  // 1) stage+commit benchmark
  await stageMatrixGrid({
    appSessionId,
    matrixType: "benchmark",
    tsMs,
    coins,
    values: benchmark,
    meta: { source: "live" }
  });
  await commitMatrixGrid({
    appSessionId,
    matrixType: "benchmark",
    tsMs,
    coins,
    idem: `${idemPrefix ?? "benchmark"}:${tsMs}`
  });

  // 2) stage+commit pct24h (optional)
  if (pct24h) {
    await stageMatrixGrid({
      appSessionId,
      matrixType: "pct24h",
      tsMs,
      coins,
      values: pct24h,
      meta: { source: "live" }
    });
    await commitMatrixGrid({
      appSessionId,
      matrixType: "pct24h",
      tsMs,
      coins,
      idem: `${idemPrefix ?? "pct24h"}:${tsMs}`
    });
  }

  // 3) derive id_pct vs prev(benchmark) and persist
  const prevMap = await mapPrevBenchmark(tsMs, coins);
  const idObj: MatrixGridObject = {};
  for (const b of coins) {
    idObj[b] = {} as Record<string, number | null>;
    for (const q of coins) {
      if (b === q) continue;
      const now = benchmark?.[b]?.[q];
      const prev = prevMap.get(`${b}/${q}`);
      if (now == null || prev == null || Math.abs(prev) < 1e-300) {
        idObj[b][q] = null;
      } else {
        idObj[b][q] = (Number(now) - prev) / prev; // id_pct = (bm_new - bm_prev)/bm_prev
      }
    }
  }
  await stageMatrixGrid({
    appSessionId,
    matrixType: "id_pct",
    tsMs,
    coins,
    values: idObj,
    meta: { source: "derived@db", base: "prev(benchmark)" }
  });
  await commitMatrixGrid({
    appSessionId,
    matrixType: "id_pct",
    tsMs,
    coins,
    idem: `${idemPrefix ?? "id_pct"}:${tsMs}`
  });
}

/* -------------------------------------------------------------------------- */
/*                        CLI utilities (former db.mts)                        */
/* -------------------------------------------------------------------------- */

type Step = { name: string; files: string[] };

const BASE_STEP: Step = {
  name: "BASE DDLs",
  files: [
    "00_extensions.sql",
    "01_settings.sql",
    "02_market.sql",
    "03_docs.sql",
    "04_matrices.sql",
    "05_str_aux.sql",
    "06_cin_aux_core.sql",
    "07_cin_aux_runtime.sql",
    "08_cin_aux_functions.sql",
    "09_ops.sql",
    "09_ingest.sql",
    "10_helpers.sql",
    "11_views_latest.sql",
  ],
};

const PATCH_STEP: Step = {
  name: "PATCH SET v1",
  files: [
    "01_settings_patches.sql",
    "02_market_patches.sql",
    "03_docs_patches.sql",
    "04_matrices_patches.sql",
    "05_str_aux_patches.sql",
    "06_cin_aux_core_patches.sql",
    "07_cin_aux_runtime_patches.sql",
    "08_cin_aux_functions_patches.sql",
    "09_mea_dynamics_patches.sql",
    "10_ops_patches.sql",
    "11_remove_bootstrap.sql",
  ],
};

const SEED_STEP: Step = { name: "SEEDS", files: ["01_seed.sql", "02_seed_jobs.sql"] };
const VERIFY_STEP: Step = { name: "VERIFY", files: ["03_verify.sql"] };

async function spawnCommand(cmd: string, args: string[], env?: NodeJS.ProcessEnv) {
  const { spawn } = await import("node:child_process");
  return new Promise<void>((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: "inherit", env });
    child.on("error", reject);
    child.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`${cmd} exited with ${code}`))));
  });
}

export async function runDbTool(
  argv: string[] = typeof process !== "undefined" ? process.argv.slice(2) : [],
  opts: { root?: string } = {},
): Promise<void> {
  const [{ resolve, join }, fs, dotenv] = await Promise.all([
    import("node:path"),
    import("node:fs"),
    import("dotenv"),
  ]);

  const ROOT = resolve(process.cwd(), opts.root ?? "db");
  const ENV_FILE = join(ROOT, ".env.db");
  if (fs.existsSync(ENV_FILE)) {
    dotenv.config({ path: ENV_FILE });
  }

  const pg = {
    host: process.env.PGHOST ?? "localhost",
    port: String(process.env.PGPORT ?? "5432"),
    db: process.env.PGDATABASE ?? "postgres",
    user: process.env.PGUSER ?? "postgres",
    pass: process.env.PGPASSWORD ?? "",
  };

  const fileExists = (file: string) => fs.existsSync(join(ROOT, file));

  async function ensurePsql() {
    await spawnCommand("psql", ["--version"]);
  }

  async function execSql(file: string) {
    if (!fileExists(file)) return;
    const full = join(ROOT, file);
    await spawnCommand(
      "psql",
      [
        "-X",
        "-v",
        "ON_ERROR_STOP=1",
        "-h",
        pg.host,
        "-p",
        pg.port,
        "-U",
        pg.user,
        "-d",
        pg.db,
        "-f",
        full,
      ],
      { ...process.env, PGPASSWORD: pg.pass },
    );
  }

  async function runStep(step: Step) {
    console.log(`\n=== ${step.name} ===`);
    for (const file of step.files) {
      if (!fileExists(file)) continue;
      console.log(`-> ${file}`);
      await execSql(file);
    }
  }

  async function ensureDb() {
    const sql = `DO $$
     BEGIN
       IF NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = '${pg.db}') THEN
         EXECUTE 'CREATE DATABASE ${pg.db}';
       END IF;
     END$$;`;
    await spawnCommand(
      "psql",
      [
        "-X",
        "-v",
        "ON_ERROR_STOP=1",
        "-h",
        pg.host,
        "-p",
        pg.port,
        "-U",
        pg.user,
        "-d",
        "postgres",
        "-c",
        sql,
      ],
      { ...process.env, PGPASSWORD: pg.pass },
    );
  }

  function usage() {
    console.log(`
Usage:
  pnpm db:apply     # base DDLs + patches
  pnpm db:seed      # seeds (universe/timing/session/jobs)
  pnpm db:verify    # quick checks
  pnpm db:all       # ensure DB, apply, seed, verify
  pnpm db:psql      # open interactive psql to PGDATABASE

ENV: read from db/.env.db (PGHOST, PGPORT, PGDATABASE, PGUSER, PGPASSWORD)
`.trim());
  }

  const [cmd = ""] = argv;
  await ensurePsql();

  if (cmd === "apply") {
    await runStep(BASE_STEP);
    await runStep(PATCH_STEP);
    console.log("[ok] apply complete");
    return;
  }

  if (cmd === "seed") {
    await runStep(SEED_STEP);
    console.log("[ok] seed complete");
    return;
  }

  if (cmd === "verify") {
    await runStep(VERIFY_STEP);
    console.log("[ok] verify complete");
    return;
  }

  if (cmd === "all") {
    await ensureDb();
    await runStep(BASE_STEP);
    await runStep(PATCH_STEP);
    await runStep(SEED_STEP);
    await runStep(VERIFY_STEP);
    console.log("[ok] all done");
    return;
  }

  if (cmd === "psql") {
    await spawnCommand(
      "psql",
      ["-h", pg.host, "-p", pg.port, "-U", pg.user, "-d", pg.db],
      { ...process.env, PGPASSWORD: pg.pass },
    );
    return;
  }

  usage();
  throw new Error(`Unknown db command "${cmd}"`);
}

async function maybeRunDbToolFromCli() {
  if (typeof process === "undefined" || !process.argv?.[1]) return;
  try {
    const { pathToFileURL } = await import("node:url");
    if (import.meta.url !== pathToFileURL(process.argv[1]!).href) return;
  } catch {
    return;
  }

  try {
    await runDbTool(process.argv.slice(2));
  } catch (err) {
    console.error(err);
    process.exitCode = 1;
  }
}

void maybeRunDbToolFromCli();
