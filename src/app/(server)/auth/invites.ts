import { sql } from "@/core/db/db";

export type InviteWithRequest = {
  invite_id: string;
  email: string;
  token: string;
  status: "issued" | "used" | "revoked" | "expired";
  expires_at: Date | null;
  created_at: Date;
  request_id: string | null;
  requested_nickname: string | null;
};

export async function getValidInviteByToken(
  token: string
): Promise<InviteWithRequest | null> {
  if (!token || !token.trim()) return null;

  const rows = await sql`
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

  if (rows.length === 0) return null;
  const r = rows[0] as InviteWithRequest;

  // only allow issued + not expired
  if (r.status !== "issued") return null;
  if (r.expires_at && r.expires_at <= new Date()) return null;

  return r;
}

export type CreatedUser = {
  user_id: string;
  email: string;
  nickname: string | null;
  is_admin: boolean;
  status: "active" | "suspended" | "invited";
};

export async function createUserFromInvite(
  token: string,
  nicknameOverride?: string | null
): Promise<CreatedUser | null> {
  const invite = await getValidInviteByToken(token);
  if (!invite) return null;

  const email = invite.email.toLowerCase();

  // If user already exists, we consider the invite invalid for registration
  const existing = await sql`
    SELECT user_id, email, nickname, is_admin, status
    FROM auth.user_account
    WHERE lower(email) = ${email}
    LIMIT 1
  `;
  if (existing.length > 0) {
    return null;
  }

  const nickname =
    (nicknameOverride && nicknameOverride.trim()) ||
    invite.requested_nickname ||
    (email.includes("@") ? email.split("@")[0] : email);

  const result = await sql.begin(async (tx: any) => {
    const [user] = await tx`
      INSERT INTO auth.user_account (
        email,
        nickname,
        invite_id,
        status
      )
      VALUES (
        ${email},
        ${nickname},
        ${invite.invite_id},
        'active'
      )
      RETURNING user_id, email, nickname, is_admin, status
    `;

    await tx`
      UPDATE auth.invite_token
      SET
        status = 'used',
        used_at = now(),
        used_by_user_id = ${user.user_id}
      WHERE invite_id = ${invite.invite_id}
    `;

    return { user };
  });

  return result.user as CreatedUser;
}
