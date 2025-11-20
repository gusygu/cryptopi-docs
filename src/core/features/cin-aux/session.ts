/**
 * core/features/cin-aux/session.ts
 * Helpers to inspect the cin_session table (type + summaries).
 */

import { getPool } from "./db";

export type CinSessionIdType = "uuid" | "bigint";

export type CinSessionSummary = {
  sessionId: string;
  windowLabel: string | null;
  startedAt: string | null;
  endedAt: string | null;
  closed: boolean;
  openingPrincipalUsdt: string | null;
  openingProfitUsdt: string | null;
  closingPrincipalUsdt: string | null;
  closingProfitUsdt: string | null;
};

type CinSessionRow = {
  session_id: string | number;
  window_label: string | null;
  started_at: Date | string | null;
  ended_at: Date | string | null;
  closed: boolean | null;
  opening_principal_usdt: string | null;
  opening_profit_usdt: string | null;
  closing_principal_usdt: string | null;
  closing_profit_usdt: string | null;
};

async function querySessionIdType(): Promise<string> {
  const pool = getPool();
  const q = await pool.query(`
    SELECT data_type
    FROM information_schema.columns
    WHERE table_schema='strategy_aux'
      AND table_name='cin_session'
      AND column_name='session_id'
    LIMIT 1;
  `);
  return (q.rows[0]?.data_type || "").toLowerCase();
}

export async function detectCinSessionIdType(): Promise<CinSessionIdType> {
  const t = await querySessionIdType();
  if (t.includes("uuid")) return "uuid";
  if (t.includes("bigint") || t.includes("int8")) return "bigint";
  throw new Error(`cin_session.session_id has unexpected type: ${t || "unknown"}`);
}

export async function fetchCinSessions(opts?: { limit?: number }): Promise<{
  idType: CinSessionIdType;
  sessions: CinSessionSummary[];
}> {
  const idType = await detectCinSessionIdType();
  const limit = Math.max(1, Math.min(50, Math.floor(opts?.limit ?? 8)));
  const pool = getPool();
  const baseSelect = `
    SELECT
      s.session_id,
      s.window_label,
      s.started_at,
      s.ended_at,
      s.closed,
      r.opening_principal_usdt,
      r.opening_profit_usdt,
      r.closing_principal_usdt,
      r.closing_profit_usdt
    FROM strategy_aux.cin_session s
  `;
  const viewJoin = `
    LEFT JOIN strategy_aux.v_cin_session_rollup r USING (session_id)
  `;
  const fallbackJoin = `
    LEFT JOIN (
      SELECT
        session_id,
        SUM(opening_principal) AS opening_principal_usdt,
        SUM(opening_profit)    AS opening_profit_usdt,
        SUM(closing_principal) AS closing_principal_usdt,
        SUM(closing_profit)    AS closing_profit_usdt
      FROM strategy_aux.cin_balance
      GROUP BY session_id
    ) r USING (session_id)
  `;
  const tail = `
    ORDER BY s.started_at DESC NULLS LAST, s.session_id::text DESC
    LIMIT $1
  `;

  let q;
  try {
    q = await pool.query(`${baseSelect} ${viewJoin} ${tail}`, [limit]);
  } catch (err: unknown) {
    const code = typeof err === "object" && err ? (err as { code?: string }).code : undefined;
    if (code !== "42P01") throw err;
    q = await pool.query(`${baseSelect} ${fallbackJoin} ${tail}`, [limit]);
  }

  const sessions: CinSessionSummary[] = q.rows.map((row: CinSessionRow) => ({
    sessionId: String(row.session_id),
    windowLabel: row.window_label ?? null,
    startedAt: row.started_at ? new Date(row.started_at).toISOString() : null,
    endedAt: row.ended_at ? new Date(row.ended_at).toISOString() : null,
    closed: Boolean(row.closed),
    openingPrincipalUsdt: row.opening_principal_usdt ?? null,
    openingProfitUsdt: row.opening_profit_usdt ?? null,
    closingPrincipalUsdt: row.closing_principal_usdt ?? null,
    closingProfitUsdt: row.closing_profit_usdt ?? null,
  }));

  return { idType, sessions };
}
