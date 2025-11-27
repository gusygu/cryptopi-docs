// Session + timeframe utilities (shared across CLI/server) + lightweight SQL tag helper.

import type { QueryResult } from "pg";
import { db, getPool, query, withClient } from "./pool_server";
import { mkdirSync, existsSync, readFileSync, writeFileSync } from "fs";
import { resolve, dirname } from "path";
import { randomBytes } from "crypto";

/* ����������������������������� Tagged SQL helper �������������������������� */

type SqlTransactionTag = <T = any>(
  strings: TemplateStringsArray,
  ...values: any[]
) => Promise<T[]>;

export interface SqlTag extends SqlTransactionTag {
  begin<T>(fn: (tx: SqlTransactionTag) => Promise<T>): Promise<T>;
}

function compileSql(strings: TemplateStringsArray, values: any[]) {
  let text = "";
  const params: any[] = [];
  for (let i = 0; i < strings.length; i++) {
    text += strings[i];
    if (i < values.length) {
      params.push(values[i]);
      text += `$${params.length}`;
    }
  }
  return { text, params };
}

async function runSqlTag<T>(
  strings: TemplateStringsArray,
  values: any[]
): Promise<T[]> {
  const { text, params } = compileSql(strings, values);
  const res: QueryResult<T> = await query<T>(text, params);
  return res.rows;
}

export const sql = Object.assign(
  async function sql<T = any>(
    strings: TemplateStringsArray,
    ...values: any[]
  ): Promise<T[]> {
    return runSqlTag<T>(strings, values);
  },
  {
    begin: async <T>(fn: (tx: SqlTransactionTag) => Promise<T>): Promise<T> => {
      return withClient(async (client) => {
        await client.query("BEGIN");
        try {
          const tx: SqlTransactionTag = async <R = any>(
            strings: TemplateStringsArray,
            ...values: any[]
          ): Promise<R[]> => {
            const { text, params } = compileSql(strings, values);
            const res: QueryResult<R> = await client.query<R>(text, params);
            return res.rows;
          };
          const result = await fn(tx);
          await client.query("COMMIT");
          return result;
        } catch (err) {
          await client.query("ROLLBACK");
          throw err;
        }
      });
    },
  }
) as SqlTag;

/* ����������������������������� Duration & Windows �������������������������� */

export type WindowLike = string | number; // "30s","5m","1h","1d" or ms

/** Parse "1h30m15s", "45m", "3500ms" (case-insensitive). Numbers are treated as ms. */
export function parseDuration(input: WindowLike): number {
  if (typeof input === "number" && Number.isFinite(input)) return Math.max(0, Math.floor(input));
  const s = String(input).trim().toLowerCase();
  if (/^\d+$/.test(s)) return parseInt(s, 10); // plain ms
  const re = /(-?\d+(?:\.\d+)?)(ms|s|m|h|d)/g;
  let m: RegExpExecArray | null, total = 0;
  while ((m = re.exec(s))) {
    const v = parseFloat(m[1]);
    const u = m[2];
    if (u === "ms") total += v;
    else if (u === "s") total += v * 1_000;
    else if (u === "m") total += v * 60_000;
    else if (u === "h") total += v * 3_600_000;
    else if (u === "d") total += v * 86_400_000;
  }
  return Math.max(0, Math.floor(total));
}

/** Canonical pretty formatter for common windows; else returns e.g. "900000ms". */
export function formatWindow(ms: number): string {
  const map: Record<number, string> = {
    1_000: "1s", 5_000: "5s", 15_000: "15s", 30_000: "30s",
    60_000: "1m", 300_000: "5m", 900_000: "15m", 1_800_000: "30m",
    3_600_000: "1h", 7_200_000: "2h", 14_400_000: "4h", 86_400_000: "1d"
  };
  return map[ms] ?? `${ms}ms`;
}

export function toMs(w: WindowLike): number { return parseDuration(w); }

/* ����������������������������� Window alignment ���������������������������� */

export function startOfWindow(ts: number, w: WindowLike): number {
  const ms = toMs(w) || 1;
  return Math.floor(ts / ms) * ms;
}
export function endOfWindow(ts: number, w: WindowLike): number {
  const ms = toMs(w) || 1;
  return Math.ceil(ts / ms) * ms;
}
export function align(ts: number, w: WindowLike, mode: "floor"|"ceil"|"round" = "floor"): number {
  const ms = toMs(w) || 1;
  if (mode === "ceil") return Math.ceil(ts / ms) * ms;
  if (mode === "round") return Math.round(ts / ms) * ms;
  return Math.floor(ts / ms) * ms;
}
export function prevWindowStart(ts: number, w: WindowLike): number {
  const ms = toMs(w) || 1; return startOfWindow(ts, ms) - ms;
}
export function nextWindowStart(ts: number, w: WindowLike): number {
  const ms = toMs(w) || 1; return endOfWindow(ts, ms);
}
export function windowRange(ts: number, w: WindowLike): { start: number; end: number } {
  const s = startOfWindow(ts, w); const ms = toMs(w) || 1; return { start: s, end: s + ms };
}
export function listWindowStarts(startTs: number, endTs: number, w: WindowLike): number[] {
  const ms = toMs(w) || 1;
  const first = startOfWindow(startTs, ms);
  const out: number[] = [];
  for (let t = first; t < endTs; t += ms) out.push(t);
  return out;
}
export function stepIndexSince(epochStart: number, ts: number, w: WindowLike): number {
  const ms = toMs(w) || 1;
  return Math.max(0, Math.floor((ts - epochStart) / ms));
}

/* ����������������������������� Cycles (DB-backed) �������������������������� */

export function floorToPeriod(ts: number, period: WindowLike): number {
  const ms = toMs(period) || 1;
  return Math.floor(ts / ms) * ms;
}

export async function ensureCycle(cycleTs: number): Promise<void> {
  await db.query(
    `INSERT INTO cycles (cycle_ts) VALUES ($1)
       ON CONFLICT (cycle_ts) DO NOTHING`,
    [cycleTs]
  );
}

export async function ensureCyclesBetween(fromTs: number, toTs: number, period: WindowLike): Promise<number> {
  const ms = toMs(period) || 1;
  const start = floorToPeriod(fromTs, ms);
  const end = floorToPeriod(toTs, ms);
  const values: number[] = [];
  for (let t = start; t <= end; t += ms) values.push(t);
  if (!values.length) return 0;

  // bulk insert in one statement
  const params = values.map((_, i) => `($${i + 1})`).join(",");
  await db.query(
    `INSERT INTO cycles (cycle_ts) VALUES ${params}
       ON CONFLICT (cycle_ts) DO NOTHING`,
    values
  );
  return values.length;
}

export async function getLatestCycle(): Promise<number | null> {
  const { rows } = await db.query(`SELECT cycle_ts FROM cycles ORDER BY cycle_ts DESC LIMIT 1`);
  return rows.length ? Number(rows[0].cycle_ts) : null;
}

/* ����������������������������� App Session Registry ������������������������� */

export type AppSession = { app_session_id: string; started_at: string };

const SESSION_FILE = resolve(process.cwd(), "var", "current-session.json");
function ensureSessionFileDir() { mkdirSync(dirname(SESSION_FILE), { recursive: true }); }
function newSessionId() {
  const rnd = randomBytes(4).toString("hex");
  return `sess_${Date.now()}_${rnd}`;
}

/** Create a new app session row (or ensure an existing id). Returns id. */
export async function createAppSession(id?: string): Promise<string> {
  const sid = id ?? newSessionId();
  await db.query(
    `INSERT INTO app_sessions (app_session_id) VALUES ($1)
       ON CONFLICT (app_session_id) DO NOTHING`,
    [sid]
  );
  return sid;
}

/** Mark an id as the current CLI/default session (saved to var/current-session.json). */
export function useAppSession(id: string) {
  ensureSessionFileDir();
  writeFileSync(SESSION_FILE, JSON.stringify({ id }, null, 2), "utf8");
}

/** Read current CLI/default session id (ENV wins). */
export function currentAppSession(): string | null {
  if (process.env.APP_SESSION_ID) return String(process.env.APP_SESSION_ID);
  if (!existsSync(SESSION_FILE)) return null;
  try {
    const j = JSON.parse(readFileSync(SESSION_FILE, "utf8"));
    return typeof j?.id === "string" ? j.id : null;
  } catch { return null; }
}

/** List most recent app sessions for selection UIs. */
export async function listAppSessions(limit = 50): Promise<AppSession[]> {
  const { rows } = await db.query(
    `SELECT app_session_id, started_at
       FROM app_sessions
   ORDER BY started_at DESC
      LIMIT $1`,
    [limit]
  );
  return rows as AppSession[];
}

/* ����������������������������� Convenience helpers ������������������������� */

export function nowMs() { return Date.now(); }

export function parseNowOrMs(s?: string): number {
  if (!s || s === "now") return Date.now();
  const n = Number(s);
  if (Number.isFinite(n)) return n;
  return parseDuration(s); // allow "5m" here too
}
