import { NextResponse } from "next/server";
import { getPool } from "@/core/features/cin-aux/db";

export async function POST() {
  const pool = getPool();

  try {
    // 1. Create new runtime session
    const { rows } = await pool.query(
      `
      INSERT INTO cin_aux.rt_session (window_label)
      VALUES ('manual-open')
      RETURNING session_id, started_at;
      `
    );

    const session = rows[0];
    const id = session.session_id;

    // 2. Insert minimal imprint luggage row (required by UI)
    await pool.query(
      `
      INSERT INTO cin_aux.rt_imprint_luggage (
        session_id,
        imprint_principal_churn_usdt,
        imprint_profit_churn_usdt,
        imprint_generated_profit_usdt,
        imprint_trace_sum_usdt,
        imprint_devref_sum_usdt,
        luggage_total_principal_usdt,
        luggage_total_profit_usdt
      )
      VALUES ($1,0,0,0,0,0,0,0)
      `,
      [id]
    );

    return NextResponse.json({
      ok: true,
      sessionId: id,
      startedAt: session.started_at,
    });
  } catch (err) {
    console.error("open runtime session error:", err);
    return NextResponse.json(
      { ok: false, error: (err as Error).message },
      { status: 500 }
    );
  }
}
