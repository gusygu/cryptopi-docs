// Unified Postgres access layer (connection + helpers + ledgers + openings + sessions)

import { Pool, type PoolClient, type QueryResult } from "pg";
import { randomBytes } from "crypto";
import { mkdirSync, existsSync, readFileSync, writeFileSync } from "fs";
import { resolve, dirname } from "path";

/* ────────────────────────────── Pool setup ────────────────────────────── */

function asBool(v: any, def = false) {
  if (v == null) return def;
  const s = String(v).trim().toLowerCase();
  return s === "1" || s === "true" || s === "yes" || s === "on";
}

const useUrl = !!process.env.DATABASE_URL;
const base = useUrl
  ? { connectionString: String(process.env.DATABASE_URL) }
  : {
      host: String(process.env.PGHOST ?? "localhost"),
      port: Number(process.env.PGPORT ?? 5432),
      user: String(process.env.PGUSER ?? ""),
      password: String(process.env.PGPASSWORD ?? ""),
      database: String(process.env.PGDATABASE ?? ""),
    };

const poolConfig = {
  ...base,
  max: Number(process.env.DB_POOL_MAX ?? 10),
  idleTimeoutMillis: Number(process.env.DB_IDLE_MS ?? 45_000),
  connectionTimeoutMillis: Number(process.env.DB_CONN_TIMEOUT_MS ?? 5_000),
  ssl: asBool(process.env.DB_SSL) ? { rejectUnauthorized: false as const } : undefined,
};

declare global {
   
  var __core_pg_pool__: Pool | undefined;
}

export function getPool(): Pool {
  if (!global.__core_pg_pool__) {
    global.__core_pg_pool__ = new Pool(poolConfig as any);
  }
  return global.__core_pg_pool__!;
}

export const db = getPool();

/** Convenience wrappers */
export async function withClient<T>(fn: (c: PoolClient) => Promise<T>) {
  const c = await db.connect();
  try { return await fn(c); } finally { c.release(); }
}

export async function query<T = any>(text: string, params?: any[]): Promise<QueryResult<T>> {
  return db.query<T>(text, params);
}

/* ────────────────────────────── App Ledger ────────────────────────────── */
export type AppLedgerEvent = {
  topic: string;
  event: string;
  payload?: unknown;
  session_id?: string;
  idempotency_key?: string;
  ts_epoch_ms: number;
};

export async function appendAppLedger(e: AppLedgerEvent) {
  await db.query(
    `INSERT INTO app_ledger (topic,event,payload,session_id,idempotency_key,ts_epoch_ms)
     VALUES ($1,$2,$3,$4,$5,$6)
     ON CONFLICT (idempotency_key) DO NOTHING`,
    [e.topic, e.event, e.payload ?? null, e.session_id ?? null, e.idempotency_key ?? null, e.ts_epoch_ms]
  );
}

/* ────────────────────────────── Opening helpers ────────────────────────────── */

const openingCache = new Map<string, { price: number; ts: number }>();
const keyStr = (b: string, q: string, w: string, sid: string) => `${b}:${q}:${w}:${sid}`;

export async function getOpening(base: string, quote = "USDT", window = "1h", appSessionId = "global") {
  const ck = keyStr(base, quote, window, appSessionId);
  const hit = openingCache.get(ck);
  if (hit) return hit;

  const q = `
    SELECT opening_ts AS ts, opening_price AS price
      FROM strategy_aux.str_aux_session
     WHERE pair_base=$1 AND pair_quote=$2 AND window_key=$3
       AND ($4::text IS NULL OR app_session_id=$4)
       AND opening_stamp=TRUE
  ORDER BY opening_ts DESC LIMIT 1
  `;
  const { rows } = await db.query(q, [base, quote, window, appSessionId]);
  if (rows.length) {
    const val = { price: Number(rows[0].price), ts: Number(rows[0].ts) };
    openingCache.set(ck, val);
    return val;
  }
  return null;
}

/* ────────────────────────────── Sessions ────────────────────────────── */

const SESSION_FILE = resolve(process.cwd(), "var", "current-session.json");
function ensureDir() { mkdirSync(dirname(SESSION_FILE), { recursive: true }); }
function newSessionId() { return `sess_${Date.now()}_${randomBytes(4).toString("hex")}`; }

export async function createAppSession(id?: string): Promise<string> {
  const sid = id ?? newSessionId();
  await db.query(
    `INSERT INTO app_sessions (app_session_id) VALUES ($1)
     ON CONFLICT (app_session_id) DO NOTHING`,
    [sid]
  );
  return sid;
}

export function useAppSession(id: string) {
  ensureDir();
  writeFileSync(SESSION_FILE, JSON.stringify({ id }, null, 2), "utf8");
}

export function currentAppSession(): string | null {
  if (process.env.APP_SESSION_ID) return String(process.env.APP_SESSION_ID);
  if (!existsSync(SESSION_FILE)) return null;
  try {
    const j = JSON.parse(readFileSync(SESSION_FILE, "utf8"));
    return typeof j?.id === "string" ? j.id : null;
  } catch { return null; }
}

/* ────────────────────────────── Ephemeral Session KV ────────────────────────────── */
class SessionKV<V = unknown> {
  private s = new Map<string, { v: V; exp?: number }>();
  set(ns: string, key: string, v: V, ttlMs?: number) {
    const k = `${ns}:${key}`; this.s.set(k, { v, exp: ttlMs ? Date.now()+ttlMs : undefined });
  }
  get(ns: string, key: string): V | undefined {
    const k = `${ns}:${key}`; const e = this.s.get(k);
    if (!e) return;
    if (e.exp && Date.now() > e.exp) { this.s.delete(k); return; }
    return e.v;
  }
  delete(ns: string, key: string) { this.s.delete(`${ns}:${key}`); }
  clear(ns?: string) {
    if (!ns) return this.s.clear();
    const p = `${ns}:`;
    for (const k of Array.from(this.s.keys())) if (k.startsWith(p)) this.s.delete(k);
  }
}

export const sessionKV = new SessionKV<any>();
