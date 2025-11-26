import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { query } from "@/core/db";
import { requireAdmin } from "@/lib/auth/server";

function randomToken() {
  return crypto.randomBytes(32).toString("hex");
}
function hashToken(raw: string) {
  return crypto.createHash("sha256").update(raw).digest("hex");
}

export async function POST(req: NextRequest) {
  const admin = await requireAdmin();
  const body = await req.json().catch(() => ({}));

  const email = String(body.email || "").trim().toLowerCase() || null;
  const requestId = body.requestId ?? null;
  const days = Number(body.days || 7);

  const token = randomToken();
  const tokenHash = hashToken(token);

  const { rows } = await query(
    `insert into auth.invite (email, token_hash, created_by, request_id, expires_at)
     values ($1, $2, $3, $4, now() + ($5::text || ' days')::interval)
     returning invite_id, expires_at`,
    [email, tokenHash, admin.user_id, requestId, days],
  );

  if (requestId) {
    await query(
      `update auth.invite_request
          set status = 'converted',
              decided_at = now(),
              decided_by = $2
        where request_id = $1
          and status = 'pending'`,
      [requestId, admin.user_id],
    );
  }

  const inviteId = rows[0].invite_id;
  const base = process.env.NEXT_PUBLIC_BASE_URL ?? "";
  const inviteUrl = `${base}/auth?invite=${encodeURIComponent(token)}`;

  await query(
    `insert into auth.audit_log (user_id, event, details)
     values ($1, 'invite.created', jsonb_build_object('invite_id', $2, 'email', $3))`,
    [admin.user_id, inviteId, email],
  );

  // for now we just return the token/url; later you send via email
  return NextResponse.json({ ok: true, inviteId, token, inviteUrl });
}
