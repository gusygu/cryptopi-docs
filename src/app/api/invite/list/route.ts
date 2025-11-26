import { NextResponse } from "next/server";
import { sql } from "@/core/db/db";
import { requireAdmin } from "../_admin";

export async function GET(req: Request) {
  const adminCheck = await requireAdmin();
  if (!adminCheck.ok) return adminCheck.response!;

  const url = new URL(req.url);
  const status = url.searchParams.get("status") ?? "pending";
  const limit = Math.min(
    100,
    Math.max(1, Number(url.searchParams.get("limit") ?? 50))
  );

  // Basic filter by status; "all" lists everything
  const rows =
    status === "all"
      ? await sql`
          SELECT
            request_id,
            email,
            nickname,
            note,
            status,
            requested_from_ip,
            requested_user_agent,
            approved_by_user_id,
            rejected_by_user_id,
            approved_at,
            rejected_at,
            created_at,
            updated_at
          FROM auth.invite_request
          ORDER BY created_at DESC
          LIMIT ${limit}
        `
      : await sql`
          SELECT
            request_id,
            email,
            nickname,
            note,
            status,
            requested_from_ip,
            requested_user_agent,
            approved_by_user_id,
            rejected_by_user_id,
            approved_at,
            rejected_at,
            created_at,
            updated_at
          FROM auth.invite_request
          WHERE status = ${status}
          ORDER BY created_at DESC
          LIMIT ${limit}
        `;

  return NextResponse.json({
    ok: true,
    items: rows,
  });
}
