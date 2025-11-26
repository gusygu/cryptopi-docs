import { randomBytes } from "crypto";
import { NextResponse } from "next/server";
import { sql } from "@/core/db/db";
import { requireAdmin } from "../_admin";

function generateToken(): string {
  // 16 bytes hex => 32-char token, easy to send in URLs
  return randomBytes(16).toString("hex");
}

export async function POST(req: Request) {
  const adminCheck = await requireAdmin();
  if (!adminCheck.ok) return adminCheck.response!;
  const { session } = adminCheck;

  const body = await req.json().catch(() => ({}));
  const requestId = body.request_id as string | undefined;
  const expiresInHoursRaw = Number(body.expires_in_hours ?? 48);
  const expiresInHours = Number.isFinite(expiresInHoursRaw)
    ? Math.max(1, Math.min(24 * 30, expiresInHoursRaw))
    : 48;

  if (!requestId) {
    return NextResponse.json(
      { ok: false, error: "missing_request_id" },
      { status: 400 }
    );
  }

  // Fetch request and ensure it's pending
  const reqRows = await sql`
    SELECT request_id, email, status
    FROM auth.invite_request
    WHERE request_id = ${requestId}
    LIMIT 1
  `;

  if (reqRows.length === 0) {
    return NextResponse.json(
      { ok: false, error: "request_not_found" },
      { status: 404 }
    );
  }

  const request = reqRows[0];
  if (request.status !== "pending") {
    return NextResponse.json(
      { ok: false, error: "request_not_pending", status: request.status },
      { status: 409 }
    );
  }

  // Best-effort: try to get admin user_id from auth.user_account
  let adminUserId: string | null = null;
  if (session?.email) {
    const adminRows = await sql`
      SELECT user_id
      FROM auth.user_account
      WHERE lower(email) = ${session.email.toLowerCase()}
      LIMIT 1
    `;
    if (adminRows.length > 0) {
      adminUserId = adminRows[0].user_id;
    }
  }

  const token = generateToken();

  // Do the approval + token creation in a single transaction style
  const result = await sql.begin(async (tx: any) => {
    const [updatedReq] = await tx`
      UPDATE auth.invite_request
      SET
        status = 'approved',
        approved_by_user_id = ${adminUserId},
        approved_at = now(),
        updated_at = now()
      WHERE request_id = ${requestId}
        AND status = 'pending'
      RETURNING request_id, email, status, approved_at
    `;

    if (!updatedReq) {
      throw new Error("invite_request_not_pending");
    }

    const [invite] = await tx`
      INSERT INTO auth.invite_token (
        request_id,
        email,
        token,
        status,
        expires_at,
        created_by_user_id
      )
      VALUES (
        ${updatedReq.request_id},
        ${updatedReq.email},
        ${token},
        'issued',
        now() + (${expiresInHours} || ' hours')::interval,
        ${adminUserId}
      )
      RETURNING invite_id, email, token, status, expires_at, created_at
    `;

    return { updatedReq, invite };
  });

  return NextResponse.json({
    ok: true,
    request: result.updatedReq,
    invite: result.invite,
  });
}
