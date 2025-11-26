import { NextRequest, NextResponse } from "next/server";
import { query } from "@/core/db";
import { requireAdmin } from "@/lib/auth/server";

export async function GET(req: NextRequest) {
  await requireAdmin();

  const status = req.nextUrl.searchParams.get("status") ?? "pending";

  const { rows } = await query(
    `select request_id, email, nickname, message, status, created_at
       from auth.invite_request
      where status = $1
      order by created_at asc
      limit 200`,
    [status],
  );

  return NextResponse.json({ ok: true, requests: rows });
}
