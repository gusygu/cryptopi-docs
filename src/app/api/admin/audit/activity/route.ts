import { NextResponse } from "next/server";
import { requireUserSession } from "@/app/(server)/auth/session";
import { sql } from "@/core/db/db";

export async function GET() {
  const session = await requireUserSession();
  if (!session.isAdmin) {
    return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  }

  const rows = await sql`
    SELECT audit_id, user_id, event, details, created_at
    FROM auth.audit_log
    ORDER BY created_at DESC
    LIMIT 200
  `;

  return NextResponse.json({ ok: true, items: rows });
}
