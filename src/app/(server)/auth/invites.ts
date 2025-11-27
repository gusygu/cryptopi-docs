import { createHash } from "crypto";
import { sql } from "@/core/db/db";
import { hashPassword } from "@/lib/auth/server";
import { isEmailSuspended } from "@/lib/auth/suspension";

type InviteSource = "token" | "legacy";

export type InviteWithRequest = {
  invite_id: string;
  email: string;
  status: "issued" | "used" | "revoked" | "expired";
  expires_at: Date | null;
  created_at: Date;
  request_id: string | null;
  requested_nickname: string | null;
  source: InviteSource;
};

export type CreatedUser = {
  user_id: string;
  email: string;
  nickname: string | null;
  is_admin: boolean;
  status: "active" | "suspended" | "invited";
};

function normalizeToken(token: string) {
  return token.trim();
}

export function hashInviteToken(token: string): string {
  return createHash("sha256").update(normalizeToken(token)).digest("hex");
}

async function fetchInviteRowByToken(token: string) {
  return sql`
    SELECT
      it.invite_id,
      it.email,
      it.token,
      it.status,
      it.expires_at,
      it.created_at,
      ir.request_id,
      ir.nickname AS requested_nickname
    FROM auth.invite_token it
    LEFT JOIN auth.invite_request ir
      ON ir.request_id = it.request_id
    WHERE it.token = ${token}
    LIMIT 1
  `;
}

async function fetchLegacyInviteRow(tokenHash: string) {
  return sql`
    SELECT
      i.invite_id,
      i.email,
      i.token_hash,
      i.status,
      i.expires_at,
      i.created_at,
      i.request_id,
      ir.nickname AS requested_nickname
    FROM auth.invite i
    LEFT JOIN auth.invite_request ir
      ON ir.request_id = i.request_id
    WHERE i.token_hash = ${tokenHash}
    LIMIT 1
  `;
}

function normalizeLegacyStatus(status: string): InviteWithRequest["status"] {
  if (status === "active") return "issued";
  if (status === "used") return "used";
  if (status === "revoked") return "revoked";
  return "expired";
}

export async function getValidInviteByToken(
  token: string
): Promise<InviteWithRequest | null> {
  const normalized = normalizeToken(token);
  if (!normalized) return null;

  const hashed = hashInviteToken(normalized);

  let rows = await fetchInviteRowByToken(hashed);
  let source: InviteSource = "token";

  if (rows.length === 0) {
    rows = await fetchInviteRowByToken(normalized);

    if (rows.length > 0) {
      await sql`
        UPDATE auth.invite_token
        SET token = ${hashed}
        WHERE invite_id = ${rows[0].invite_id}
      `;
    }
  }

  let inviteRow: any = rows[0];

  if (!inviteRow) {
    const legacyRows = await fetchLegacyInviteRow(hashed);
    if (legacyRows.length === 0) return null;
    source = "legacy";
    inviteRow = legacyRows[0];
    inviteRow.status = normalizeLegacyStatus(inviteRow.status);
  }

  if (inviteRow.status !== "issued") return null;
  if (inviteRow.expires_at && inviteRow.expires_at <= new Date()) return null;

  return {
    invite_id: inviteRow.invite_id,
    email: inviteRow.email,
    status: inviteRow.status,
    expires_at: inviteRow.expires_at,
    created_at: inviteRow.created_at,
    request_id: inviteRow.request_id,
    requested_nickname: inviteRow.requested_nickname,
    source,
  };
}

export async function createUserFromInvite(params: {
  token: string;
  password: string;
  nicknameOverride?: string | null;
}): Promise<CreatedUser> {
  const invite = await getValidInviteByToken(params.token);
  if (!invite) {
    throw new Error("invalid_invite");
  }

  const email = invite.email.toLowerCase();

  if (isEmailSuspended(email)) {
    throw new Error("suspended_email");
  }

  const nickname =
    (params.nicknameOverride && params.nicknameOverride.trim()) ||
    invite.requested_nickname ||
    (email.includes("@") ? email.split("@")[0] : email);

  const passwordHash = await hashPassword(params.password);

  const result = await sql.begin(async (tx: any) => {
    const existing = await tx`
      SELECT user_id
      FROM auth."user"
      WHERE lower(email) = ${email}
      LIMIT 1
    `;
    if (existing.length > 0) {
      throw new Error("user_exists");
    }

    const [user] = await tx`
      INSERT INTO auth."user" (
        email,
        nickname,
        password_hash,
        status
      )
      VALUES (
        ${email},
        ${nickname},
        ${passwordHash},
        'active'
      )
      RETURNING user_id, email, nickname, is_admin, status
    `;

    await tx`
      INSERT INTO auth.user_account (
        email,
        nickname,
        invite_id,
        status,
        password_hash,
        updated_at,
        created_at
      )
      VALUES (
        ${email},
        ${nickname},
        ${invite.invite_id},
        'active',
        ${passwordHash},
        now(),
        now()
      )
      ON CONFLICT (email)
      DO UPDATE SET
        nickname = EXCLUDED.nickname,
        status = EXCLUDED.status,
        invite_id = EXCLUDED.invite_id,
        password_hash = EXCLUDED.password_hash,
        updated_at = now()
    `;

    if (invite.source === "legacy") {
      await tx`
        UPDATE auth.invite
        SET
          status = 'used',
          used_at = now(),
          used_by = ${user.user_id}
        WHERE invite_id = ${invite.invite_id}
      `;
    } else {
      await tx`
        UPDATE auth.invite_token
        SET
          status = 'used',
          used_at = now(),
          used_by_user_id = ${user.user_id}
        WHERE invite_id = ${invite.invite_id}
      `;
    }

    return { user };
  });

  return result.user as CreatedUser;
}
