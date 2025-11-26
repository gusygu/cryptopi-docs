// src/lib/auth/server.ts
import crypto from "crypto";
import { cookies } from "next/headers";
import type { NextRequest } from "next/server";
import { query, withClient } from "@/core/db";

const SESSION_COOKIE = "session";            // reuse your existing cookie name
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 7; // 7 days

// ───────────────── basic helpers ─────────────────

function randomToken(): string {
  return crypto.randomBytes(32).toString("hex");
}

function hashToken(raw: string): string {
  return crypto.createHash("sha256").update(raw).digest("hex");
}

export async function hashPassword(raw: string): Promise<string> {
  // scrypt with salt (simple variant; you can swap to argon2/bcrypt later)
  const salt = crypto.randomBytes(16);
  const derivedKey = await new Promise<Buffer>((resolve, reject) => {
    crypto.scrypt(raw, salt, 64, (err, key) => (err ? reject(err) : resolve(key as Buffer)));
  });
  return `${salt.toString("hex")}:${derivedKey.toString("hex")}`;
}

export async function verifyPassword(raw: string, stored: string): Promise<boolean> {
  const [saltHex, hashHex] = stored.split(":");
  if (!saltHex || !hashHex) return false;
  const salt = Buffer.from(saltHex, "hex");
  const expected = Buffer.from(hashHex, "hex");
  const derived = await new Promise<Buffer>((resolve, reject) => {
    crypto.scrypt(raw, salt, expected.length, (err, key) =>
      err ? reject(err) : resolve(key as Buffer),
    );
  });
  return crypto.timingSafeEqual(expected, derived);
}

// ───────────────── users ─────────────────

export type DbUser = {
  user_id: string;
  email: string;
  nickname: string | null;
  is_admin: boolean;
  status: string;
};

export async function findUserByEmail(email: string): Promise<DbUser | null> {
  const { rows } = await query<DbUser>(
    `select user_id, email, nickname, is_admin, status
       from auth."user"
      where email = $1`,
    [email.toLowerCase()],
  );
  return rows[0] ?? null;
}

// Create/activate user from invite token + password.
// Handles: invite validity, email binding, status, audit.
export async function createUserFromInvite(params: {
  email: string;
  nickname?: string;
  password: string;
  inviteToken: string;
}): Promise<DbUser> {
  const { email, nickname, password, inviteToken } = params;
  const tokenHash = hashToken(inviteToken);

  return await withClient<DbUser>(async (client) => {
    await client.query("BEGIN");
    try {
      const { rows: invRows } = await client.query(
        `select invite_id, email, status, expires_at, used_at
           from auth.invite
          where token_hash = $1
          for update`,
        [tokenHash],
      );
      const inv = invRows[0];
      if (!inv) throw new Error("Invalid invite");
      if (inv.status !== "active") throw new Error("Invite not active");
      if (inv.expires_at && new Date(inv.expires_at) < new Date()) {
        throw new Error("Invite expired");
      }
      if (inv.email && inv.email.toLowerCase() !== email.toLowerCase()) {
        throw new Error("Invite bound to a different email");
      }

      const pwdHash = await hashPassword(password);

      const { rows: userRows } = await client.query<DbUser>(
        `insert into auth."user" (email, nickname, password_hash, status)
         values ($1, $2, $3, 'active')
         on conflict (email) do update
           set nickname = excluded.nickname,
               password_hash = excluded.password_hash,
               status = 'active'
         returning user_id, email, nickname, is_admin, status`,
        [email.toLowerCase(), nickname || null, pwdHash],
      );
      const user = userRows[0];

      await client.query(
        `update auth.invite
            set status = 'used',
                used_at = now(),
                used_by = $2
          where invite_id = $1`,
        [inv.invite_id, user.user_id],
      );

      await client.query(
        `insert into auth.audit_log (user_id, event, details)
         values ($1, 'invite.accepted', jsonb_build_object('invite_id', $2))`,
        [user.user_id, inv.invite_id],
      );

      await client.query("COMMIT");
      return user;
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    }
  });
}

// ───────────────── sessions ─────────────────

export async function createSession(userId: string, req?: NextRequest): Promise<void> {
  const rawToken = randomToken();
  const tokenHash = hashToken(rawToken);
  const now = Date.now();
  const expiresAt = new Date(now + SESSION_TTL_MS);

  const ip = req?.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
  const ua = req?.headers.get("user-agent") ?? null;

  await query(
    `insert into auth.session (user_id, token_hash, expires_at, ip, user_agent)
     values ($1, $2, $3, $4, $5)`,
    [userId, tokenHash, expiresAt, ip, ua],
  );

  const jar = await cookies();
  jar.set(SESSION_COOKIE, rawToken, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    expires: expiresAt,
  });

  await query(`update auth."user" set last_login_at = now() where user_id = $1`, [userId]);

  await query(
    `insert into auth.audit_log (user_id, event, details)
     values ($1, 'login.success', '{}'::jsonb)`,
    [userId],
  );
}

export async function clearSessionCookieAndRevoke(): Promise<void> {
  const jar = await cookies();
  const raw = jar.get(SESSION_COOKIE)?.value ?? null;
  if (raw) {
    const tokenHash = hashToken(raw);
    await query(
      `update auth.session
          set revoked_at = now()
        where token_hash = $1
          and revoked_at is null`,
      [tokenHash],
    );
  }
  jar.delete(SESSION_COOKIE);
}

export async function getCurrentUser(opts?: { includeInactive?: boolean }): Promise<DbUser | null> {
  const jar = await cookies();
  const raw = jar.get(SESSION_COOKIE)?.value ?? null;
  if (!raw) return null;

  const tokenHash = hashToken(raw);
  const { rows } = await query<
    DbUser & { expires_at: string; revoked_at: string | null }
  >(
    `select u.user_id, u.email, u.nickname, u.is_admin, u.status,
            s.expires_at, s.revoked_at
       from auth.session s
       join auth."user" u on u.user_id = s.user_id
      where s.token_hash = $1
      order by s.created_at desc
      limit 1`,
    [tokenHash],
  );

  const row = rows[0];
  if (!row) return null;
  if (row.revoked_at) return null;
  if (new Date(row.expires_at) < new Date()) return null;
  if (row.status !== "active" && !opts?.includeInactive) return null;

  return {
    user_id: row.user_id,
    email: row.email,
    nickname: row.nickname,
    is_admin: row.is_admin,
    status: row.status,
  };
}

export async function requireAdmin(): Promise<DbUser> {
  const user = await getCurrentUser();
  if (!user || !user.is_admin) {
    throw new Error("Forbidden");
  }
  return user;
}
