import { db } from "@/core/db/db";

const PROFILE_EMAIL_QUERY = `
  select email
    from settings.profile
   where email is not null
     and btrim(email) <> ''
   order by updated_at desc
   limit 1
`;

/**
 * Resolve the canonical account/email scope used to tag market.account_trades.
 * Priority order:
 *   1) Explicit env override (CLI/env vars)
 *   2) CIN_ACCOUNT_EMAIL / CIN_RUNTIME_ACCOUNT_EMAIL envs
 *   3) settings.profile.email (latest non-null)
 *   4) "__env__" fallback for legacy env-based keys
 */
export async function resolveAccountScope(
  explicit?: string | null,
): Promise<string> {
  const prefer =
    explicit ?? process.env.CIN_ACCOUNT_EMAIL ?? process.env.CIN_RUNTIME_ACCOUNT_EMAIL;
  if (prefer && prefer.trim()) {
    return prefer.trim().toLowerCase();
  }

  try {
    const { rows } = await db.query<{ email: string | null }>(PROFILE_EMAIL_QUERY);
    const email = rows[0]?.email;
    if (email && email.trim()) {
      return email.trim().toLowerCase();
    }
  } catch (err) {
    console.warn("[cin-account-scope] failed to read profile email:", err);
  }

  return "__env__";
}

export async function ensureProfileEmailRow(
  email: string,
  nickname?: string | null,
) {
  if (!email) return;
  const normalized = email.trim().toLowerCase();
  if (!normalized) return;
  const nick =
    (nickname && nickname.trim()) ||
    (normalized.includes("@") ? normalized.split("@")[0] : normalized);

  await db.query(
    `
      insert into settings.profile (id, nickname, email)
      values (1, $2, $1)
      on conflict (id) do update set
        email = excluded.email,
        nickname = coalesce(nullif(excluded.nickname, ''), settings.profile.nickname),
        updated_at = now()
    `,
    [normalized, nick],
  );
}

export async function backfillAccountTradesEmail(email: string) {
  if (!email) return;
  const normalized = email.trim().toLowerCase();
  if (!normalized) return;
  await db.query(
    `
      update market.account_trades
         set account_email = $1
       where account_email is null
          or account_email = ''
          or account_email = '__env__'
    `,
    [normalized],
  );
}
