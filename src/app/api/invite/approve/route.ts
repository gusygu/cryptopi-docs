import { randomBytes } from "crypto";
import { NextResponse } from "next/server";
import { sql } from "@/core/db/db";
import { requireAdmin } from "../_admin";
import { logAdminAction } from "@/app/(server)/admin/log";
import { hashInviteToken } from "@/app/(server)/auth/invites";
import { notifyRequesterOfDecision } from "@/lib/notifications/invite";

let cachedModernInviteRequestSchema: boolean | null = null;
let cachedInviteTokenTable: boolean | null = null;

async function hasModernInviteRequestSchema() {
  if (cachedModernInviteRequestSchema !== null) {
    return cachedModernInviteRequestSchema;
  }
  const rows = await sql`
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'auth'
      AND table_name = 'invite_request'
      AND column_name = 'approved_by_user_id'
    LIMIT 1
  `;
  cachedModernInviteRequestSchema = rows.length > 0;
  return cachedModernInviteRequestSchema;
}

async function hasInviteTokenTable() {
  if (cachedInviteTokenTable !== null) return cachedInviteTokenTable;
  const rows = await sql`
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'auth'
      AND table_name = 'invite_token'
    LIMIT 1
  `;
  cachedInviteTokenTable = rows.length > 0;
  return cachedInviteTokenTable;
}

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

  // Best-effort: try to get admin user_id from auth."user"
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

  const token = generateToken();
  const tokenHash = hashInviteToken(token);

  const modernInviteRequest = await hasModernInviteRequestSchema();
  const inviteTokenTableExists = await hasInviteTokenTable();

  function updateRequestSql(tx: any) {
    if (modernInviteRequest) {
      return tx`
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
    }
    return tx`
      UPDATE auth.invite_request
      SET
        status = 'approved',
        decided_by = ${adminUserId},
        decided_at = now()
      WHERE request_id = ${requestId}
        AND status = 'pending'
      RETURNING
        request_id,
        email,
        status,
        decided_at AS approved_at
    `;
  }

  function insertInviteSql(tx: any, updatedReq: any) {
    if (inviteTokenTableExists) {
      return tx`
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
          ${tokenHash},
          'issued',
          now() + (${expiresInHours} || ' hours')::interval,
          ${adminUserId}
        )
        RETURNING invite_id, email, token, status, expires_at, created_at
      `;
    }
    return tx`
      INSERT INTO auth.invite (
        request_id,
        email,
        token_hash,
        status,
        expires_at,
        created_by
      )
      VALUES (
        ${updatedReq.request_id},
        ${updatedReq.email},
        ${tokenHash},
        'active',
        now() + (${expiresInHours} || ' hours')::interval,
        ${adminUserId}
      )
      RETURNING
        invite_id,
        email,
        token_hash AS token,
        status,
        expires_at,
        created_at
    `;
  }

  // Do the approval + token creation in a single transaction style
  const result = await sql.begin(async (tx: any) => {
    const rows = await updateRequestSql(tx);

    if (!rows || rows.length === 0) {
      throw new Error("invite_request_not_pending");
    }

    const updatedReq = rows[0];
    const inviteRow = await insertInviteSql(tx, updatedReq);
    const invite = Array.isArray(inviteRow) ? inviteRow[0] : inviteRow;
    const normalizedInvite = inviteTokenTableExists
      ? {
          ...invite,
          status: invite.status ?? "issued",
          source: "token" as const,
        }
      : {
        ...invite,
        status: invite.status === "active" ? "issued" : invite.status,
        source: "legacy" as const,
      };

    return { updatedReq, invite: normalizedInvite };
  });

  await logAdminAction({
    actionType: "invite.approved",
    actionScope: "invites",
    targetEmail: request.email,
    targetUserId: result.invite?.invite_id ?? null,
    message: `${session.email} approved invite request ${requestId}`,
    meta: {
      request_id: requestId,
      invite_id: result.invite?.invite_id ?? null,
      expires_at: result.invite?.expires_at ?? null,
    },
  });

  const publicBase =
    process.env.NEXT_PUBLIC_BASE_URL ||
    process.env.APP_BASE_URL ||
    (process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}`
      : "");
  const inviteLink = publicBase
    ? `${publicBase.replace(/\/$/, "")}/auth/register?invite=${token}`
    : `/auth/register?invite=${token}`;

  await notifyRequesterOfDecision({
    email: request.email,
    approved: true,
    inviteLink,
  });

  return NextResponse.json({
    ok: true,
    request: result.updatedReq,
    invite: result.invite,
    issued_token: token,
    invite_link: inviteLink,
  });
}
