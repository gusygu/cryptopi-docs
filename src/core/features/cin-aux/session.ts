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

type CinBalanceColumnMap = {
  openingPrincipal: string;
  openingProfit: string;
  closingPrincipal: string;
  closingProfit: string;
};

let cachedBalanceColumns: CinBalanceColumnMap | null = null;

async function detectCinBalanceColumnNames(): Promise<CinBalanceColumnMap> {
  if (cachedBalanceColumns) return cachedBalanceColumns;
  const pool = getPool();
  const q = await pool.query(`
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema = 'strategy_aux'
      AND table_name = 'cin_balance'
  `);
  const names = new Set<string>(q.rows.map((r: { column_name: string }) => r.column_name));
  const pick = (candidates: string[], label: string) => {
    for (const name of candidates) {
      if (names.has(name)) return name;
    }
    throw new Error(`cin_balance missing ${label} column (checked: ${candidates.join(", ")})`);
  };

  cachedBalanceColumns = {
    openingPrincipal: pick(["opening_principal", "opening_principal_usdt"], "opening_principal"),
    openingProfit: pick(["opening_profit", "opening_profit_usdt"], "opening_profit"),
    closingPrincipal: pick(["closing_principal", "closing_principal_usdt"], "closing_principal"),
    closingProfit: pick(["closing_profit", "closing_profit_usdt"], "closing_profit"),
  };

  return cachedBalanceColumns;
}

function buildAggregateJoin(columns: CinBalanceColumnMap): string {
  return `
    LEFT JOIN (
      SELECT
        session_id::text AS session_join_key,
        SUM(${columns.openingPrincipal}) AS opening_principal_usdt,
        SUM(${columns.openingProfit})    AS opening_profit_usdt,
        SUM(${columns.closingPrincipal}) AS closing_principal_usdt,
        SUM(${columns.closingProfit})    AS closing_profit_usdt
      FROM strategy_aux.cin_balance
      GROUP BY session_id::text
    ) r ON s.session_id::text = r.session_join_key
  `;
}

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
    LEFT JOIN strategy_aux.v_cin_session_rollup r
      ON s.session_id::text = r.session_id::text
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
    if (code !== "42P01" && code !== "42703" && code !== "42883") throw err;
    const columns = await detectCinBalanceColumnNames();
    const fallbackJoin = buildAggregateJoin(columns);
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
