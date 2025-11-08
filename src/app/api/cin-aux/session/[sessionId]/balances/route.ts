import { NextResponse } from "next/server";
import { getPool } from "@/core/features/cin-aux/db";

export async function GET(_: Request, { params }: { params: { sessionId: string } }) {
  const pool = getPool();
  // Works for bigint or uuid if your column is castable. If your session_id is strictly bigint,
  // cast to numeric; if uuid, cast to uuid.
  const id = params.sessionId;
  const tryBigint = /^\d+$/.test(id);

  const sql = `
    SELECT asset,
           opening_principal, opening_profit,
           closing_principal, closing_profit
    FROM strategy_aux.cin_balance
    WHERE session_id = $1
    ORDER BY asset
  `;

  const q = await pool.query(sql, [ tryBigint ? Number(id) : id ]);
  return NextResponse.json(q.rows);
}
