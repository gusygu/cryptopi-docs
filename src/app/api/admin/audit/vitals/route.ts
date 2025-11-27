import { NextResponse } from "next/server";
import { requireUserSession } from "@/app/(server)/auth/session";
import { sql } from "@/core/db/db";

export async function GET() {
  const session = await requireUserSession();
  if (!session.isAdmin) {
    return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  }

  const rows = await sql`
    SELECT vitals_id, snapshot_ts, payload
    FROM audit.vitals_log
    ORDER BY snapshot_ts DESC
    LIMIT 200
  `;

  return NextResponse.json({ ok: true, items: rows });
}
