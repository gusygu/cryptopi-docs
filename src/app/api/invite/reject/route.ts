import { NextResponse } from "next/server";
import { sql } from "@/core/db/db";
import { requireAdmin } from "../_admin";
import { logAdminAction } from "@/app/(server)/admin/log";
import { notifyRequesterOfDecision } from "@/lib/notifications/invite";

export async function POST(req: Request) {
  const adminCheck = await requireAdmin();
  if (!adminCheck.ok) return adminCheck.response!;
  const { session } = adminCheck;

  const body = await req.json().catch(() => ({}));
  const requestId = body.request_id as string | undefined;

  if (!requestId) {
    return NextResponse.json(
      { ok: false, error: "missing_request_id" },
      { status: 400 }
    );
  }

  // Best-effort: admin user_id lookup
  let adminUserId: string | null = null;
  if (session?.email) {
    const adminRows = await sql`
      SELECT user_id
      FROM auth."user"
      WHERE lower(email) = ${session.email.toLowerCase()}
      LIMIT 1
    `;
    if (adminRows.length > 0) {
      adminUserId = adminRows[0].user_id;
    }
  }

  const rows = await sql`
    UPDATE auth.invite_request
    SET
      status = 'rejected',
      rejected_by_user_id = ${adminUserId},
      rejected_at = now(),
      updated_at = now()
    WHERE request_id = ${requestId}
      AND status = 'pending'
    RETURNING request_id, email, status, rejected_at
  `;

  if (rows.length === 0) {
    return NextResponse.json(
      { ok: false, error: "request_not_pending_or_not_found" },
      { status: 409 }
    );
  }

  const request = rows[0];

  await logAdminAction({
    actionType: "invite.rejected",
    actionScope: "invites",
    targetEmail: request.email,
    message: `${session.email} rejected invite request ${requestId}`,
    meta: { request_id: requestId },
  });

  await notifyRequesterOfDecision({
    email: request.email,
    approved: false,
  });

  return NextResponse.json({
    ok: true,
    request,
  });
}
