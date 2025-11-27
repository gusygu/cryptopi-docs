import { NextResponse } from "next/server";
import { requireUserSession } from "@/app/(server)/auth/session";
import { sql } from "@/core/db/db";

export async function GET() {
  const session = await requireUserSession();
  const rows = await sql`
    SELECT cycle_seq, symbol, window_label, sample_ts, status, message, meta, created_at
    FROM audit.str_sampling_log
    WHERE owner_user_id = ${session.userId}
    ORDER BY created_at DESC
    LIMIT 200
  `;
  return NextResponse.json({ ok: true, items: rows });
}
