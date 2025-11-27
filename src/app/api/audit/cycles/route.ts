import { NextResponse } from "next/server";
import { requireUserSession } from "@/app/(server)/auth/session";
import { sql } from "@/core/db/db";

export async function GET() {
  const session = await requireUserSession();
  const rows = await sql`
    SELECT cycle_seq, status, summary, payload, created_at
    FROM audit.user_cycle_log
    WHERE owner_user_id = ${session.userId}
    ORDER BY cycle_seq DESC
    LIMIT 200
  `;
  return NextResponse.json({ ok: true, items: rows });
}
