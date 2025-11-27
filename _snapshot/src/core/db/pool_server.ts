import { Pool, type PoolClient, type QueryResult, type QueryResultRow } from "pg";

/**
 * Unified PG pool + convenience helpers + lightweight ledgers.
 * This replaces the old pool/server/ledger trio with a single source of truth.
 */

/* ──────────────── Environment helpers ──────────────── */
function asBool(v: unknown, fallback = false): boolean {
  if (v == null) return fallback;
  const s = String(v).trim().toLowerCase();
  return s === "1" || s === "true" || s === "yes" || s === "on";
}

/* ──────────────── Pool configuration ──────────────── */
const useUrl = !!process.env.DATABASE_URL;
const baseConfig = useUrl
  ? { connectionString: String(process.env.DATABASE_URL) }
  : {
      host: String(process.env.PGHOST ?? "localhost"),
      port: Number(process.env.PGPORT ?? 1026),
      user: String(process.env.PGUSER ?? "postgres"),
      password: String(process.env.PGPASSWORD ?? "gus"),
      database: String(process.env.PGDATABASE ?? "cryptopie"),
    };

const poolConfig = {
  ...baseConfig,
  max: Number(process.env.DB_POOL_MAX ?? process.env.PGPOOL_MAX ?? 10),
  idleTimeoutMillis: Number(process.env.DB_IDLE_MS ?? 45_000),
  connectionTimeoutMillis: Number(process.env.DB_CONN_TIMEOUT_MS ?? 5_000),
  ssl: asBool(process.env.DB_SSL ?? process.env.PGSSL)
    ? { rejectUnauthorized: false as const }
    : undefined,
};

const SESSION_STATEMENT_TIMEOUT = Number(process.env.DB_STATEMENT_TIMEOUT_MS ?? 15_000);
const SESSION_IDLE_TX_TIMEOUT = Number(process.env.DB_IDLE_TX_TIMEOUT_MS ?? 15_000);
const SESSION_TZ = String(process.env.DB_TIMEZONE ?? "UTC").replace(/'/g, "''");
export const DEFAULT_SEARCH_PATH = [
  "settings",
  "market",
  "docs",
  "matrices",
  "str_aux",
  "cin_aux",
  "mea_dynamics",
  "ingest",
  "ops",
  "public",
].join(", ");

/* ──────────────── Pool singleton ──────────────── */
declare global {
   
  var __core_pg_pool__: Pool | undefined;
}

function ensurePool(): Pool {
  if (!global.__core_pg_pool__) {
    const pool = new Pool(poolConfig as any);
    pool.on("connect", (client: PoolClient) => {
      const bootstrap = [
        `SET statement_timeout = ${SESSION_STATEMENT_TIMEOUT}`,
        `SET idle_in_transaction_session_timeout = ${SESSION_IDLE_TX_TIMEOUT}`,
        `SET TIME ZONE '${SESSION_TZ}'`,
        `SET search_path = ${DEFAULT_SEARCH_PATH}`,
      ];
      for (const statement of bootstrap) {
        void client.query(statement).catch(() => {
          /* ignore bootstrap failures so the pool stays usable */
        });
      }
    });
    global.__core_pg_pool__ = pool;
  }
  return global.__core_pg_pool__!;
}

export function getPool(): Pool {
  return ensurePool();
}
export function getDb(): Pool {
  return ensurePool();
}

/* ──────────────── Query helpers ──────────────── */
export async function withClient<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await ensurePool().connect();
  try {
    return await fn(client);
  } finally {
    client.release();
  }
}

export async function query<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params?: any[],
): Promise<QueryResult<T>> {
  return ensurePool().query<T>(text, params);
}

export const db: Pool = ensurePool();
export const serverDb = {
  query<T = any>(text: string, params?: any[]) {
    return ensurePool().query<T>(text, params);
  },
};

/* ──────────────── Table constants ──────────────── */
export const TABLES = {
  matrices: process.env.MATRIX_TABLE || "matrices.dyn_values",
  matricesStage: process.env.MATRIX_STAGE_TABLE || "matrices.dyn_values_stage",
  ledger: process.env.APP_LEDGER_TABLE || "ops.app_ledger",
  transfers: process.env.TRANSFER_LEDGER_TABLE || "ops.transfer_ledger",
} as const;

/* ──────────────── Ledger helpers ──────────────── */
export type AppLedgerEvent = {
  topic: string;              // e.g. "pipeline"
  event: string;              // e.g. "dyn_matrix_upsert"
  payload?: unknown;
  session_id?: string;
  idempotency_key?: string;
  ts_epoch_ms: number;
};

/** Safe insert; ignores missing table or duplicate key. */
export async function appendAppLedger(e: AppLedgerEvent): Promise<void> {
  const sql = `
    INSERT INTO ${TABLES.ledger}
      (topic, event, payload, session_id, idempotency_key, ts_epoch_ms)
    VALUES ($1,$2,$3,$4,$5,$6)
    ON CONFLICT (idempotency_key) DO NOTHING
  `;
  try {
    await query(sql, [
      e.topic,
      e.event,
      e.payload ?? null,
      e.session_id ?? null,
      e.idempotency_key ?? null,
      e.ts_epoch_ms,
    ]);
  } catch (err: any) {
    if (err?.code === "42P01") {
      console.warn("appendAppLedger: ledger table missing (ops.app_ledger). Skipping log.");
      return;
    }
    throw err;
  }
}

export async function getAppLedgerSince(sinceMs: number, topic?: string) {
  try {
    const { rows } = await query(
      `SELECT * FROM ${TABLES.ledger}
        WHERE ts_epoch_ms >= $1
          AND ($2::text IS NULL OR topic = $2)
     ORDER BY ts_epoch_ms ASC`,
      [sinceMs, topic ?? null],
    );
    return rows;
  } catch (err: any) {
    if (err?.code === "42P01") {
      console.warn("getAppLedgerSince: ledger table missing (ops.app_ledger).");
      return [];
    }
    throw err;
  }
}

/* ──────────────── Transfer ledger helpers ──────────────── */
export async function appendTransferLedger(row: {
  app_session_id: string;
  cycle_ts: number;
  leg_seq: number;
  route_id?: string | null;
  intent_id?: string | null;
  from_symbol: string;
  to_symbol: string;
  qty_from: number;
  qty_to: number;
  price_from_usdt: number;
  price_to_usdt: number;
  fee_usdt?: number;
  exec_ts: number;
  tx_id?: string | null;
}): Promise<void> {
  const q = `
    INSERT INTO ${TABLES.transfers} (
      app_session_id, cycle_ts, leg_seq, route_id, intent_id,
      from_symbol, to_symbol, qty_from, qty_to,
      price_from_usdt, price_to_usdt, fee_usdt, exec_ts, tx_id
    )
    VALUES (
      $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,COALESCE($12,0),$13,$14
    )
    ON CONFLICT (app_session_id, cycle_ts, leg_seq) DO NOTHING
  `;
  try {
    await query(q, [
      row.app_session_id,
      row.cycle_ts,
      row.leg_seq,
      row.route_id ?? null,
      row.intent_id ?? null,
      row.from_symbol,
      row.to_symbol,
      row.qty_from,
      row.qty_to,
      row.price_from_usdt,
      row.price_to_usdt,
      row.fee_usdt ?? 0,
      row.exec_ts,
      row.tx_id ?? null,
    ]);
  } catch (err: any) {
    if (err?.code === "42P01") {
      console.warn("appendTransferLedger: transfer_ledger table missing (ops.transfer_ledger).");
      return;
    }
    throw err;
  }
}

export async function listTransferLegs(
  app_session_id: string,
  opts?: { before?: number; limit?: number },
) {
  const { rows } = await query(
    `SELECT * FROM ${TABLES.transfers}
      WHERE app_session_id = $1
        AND ($2::bigint IS NULL OR cycle_ts < $2)
   ORDER BY cycle_ts DESC, leg_seq DESC
      LIMIT $3`,
    [app_session_id, opts?.before ?? null, opts?.limit ?? 200],
  );
  return rows;
}

export type { Pool, PoolClient, QueryResult, QueryResultRow };
