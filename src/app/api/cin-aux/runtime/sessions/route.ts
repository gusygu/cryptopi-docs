import { NextResponse } from "next/server";
import { db } from "@/core/db/db";
import { listRuntimeSessions } from "@/core/features/cin-aux/runtimeQueries";
import { requireUserSession } from "@/app/(server)/auth/session";

// GET: list sessions
export async function GET() {
  const session = await requireUserSession();
  const sessions = await listRuntimeSessions(session.userId);
  return NextResponse.json(sessions);
}

// POST: create session
export async function POST() {
  const session = await requireUserSession();
  try {
    const { rows } = await db.query(
      `
      INSERT INTO cin_aux.rt_session (owner_user_id, window_label)
      VALUES ($1, 'manual-open')
      RETURNING session_id, started_at;
      `
    , [session.userId]);

    const session = rows[0];
    const id = session.session_id;

    await db.query(
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
  } catch (err: any) {
    console.error("POST runtime/sessions error:", err);
    return NextResponse.json(
      { ok: false, error: err.message },
      { status: 500 }
    );
  }
}
