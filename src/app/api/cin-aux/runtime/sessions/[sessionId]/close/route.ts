import { NextResponse } from "next/server";
import { getPool } from "@/core/features/cin-aux/db";

export async function POST(
  _req: Request,
  { params }: { params: { sessionId: string } }
) {
  const pool = getPool();
  const id = Number(params.sessionId);

  if (!Number.isFinite(id)) {
    return NextResponse.json({ error: "Invalid session id" }, { status: 400 });
  }

  const { rowCount, rows } = await pool.query(
    `
    UPDATE cin_aux.rt_session
    SET closed    = true,
        closed_at = now()
    WHERE session_id = $1
    RETURNING session_id, started_at, closed_at;
    `,
    [id]
  );

  if (rowCount === 0) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }

  return NextResponse.json({ ok: true, session: rows[0] });
}
