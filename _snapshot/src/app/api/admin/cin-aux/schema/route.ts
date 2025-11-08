import { NextResponse } from "next/server";
import { getPool } from "@/core/features/cin-aux/db";

export async function GET() {
  const pool = getPool();
  const [cols, fns] = await Promise.all([
    pool.query(`
      SELECT table_name, column_name, data_type
      FROM information_schema.columns
      WHERE table_schema='strategy_aux'
        AND table_name IN ('cin_session','cin_balance','cin_move','cin_move_lotlink')
      ORDER BY table_name, ordinal_position;
    `),
    pool.query(`
      SELECT
        p.proname AS name,
        pg_get_function_identity_arguments(p.oid) AS args
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname='strategy_aux'
        AND p.proname IN ('cin_ensure_balance_row','cin_exec_move_v2','cin_consume_fifo_lots')
      ORDER BY 1;
    `),
  ]);
  return NextResponse.json({ columns: cols.rows, functions: fns.rows });
}
