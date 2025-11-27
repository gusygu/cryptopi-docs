import { notFound } from "next/navigation";
import { sql } from "@/core/db/db";
import { requireUserSession } from "@/app/(server)/auth/session";
import { getUserSettings } from "@/lib/settings/store";

type AdminUserDetail = {
  user_id: string;
  email: string;
  nickname: string | null;
  is_admin: boolean;
  status: "active" | "suspended" | "invited";
  created_at: string;
  updated_at: string;
  last_login_at: string | null;
  invite_id: string | null;
  source: "auth_user" | "user_account_only";
};

type UserAccountRow = {
  user_id: string;
  email: string;
  nickname: string | null;
  is_admin: boolean;
  status: "active" | "suspended" | "invited";
  created_at: string;
  updated_at: string;
  last_login_at: string | null;
  invite_id: string | null;
};

type Params = { userId: string };

export default async function AdminUserDetailPage({ params }: { params: Params }) {
  const session = await requireUserSession();
  if (!session.isAdmin) return null;

  const userId = params.userId;
  if (!userId) notFound();

  const coreRows = await sql`
    SELECT
      user_id,
      email,
      nickname,
      is_admin,
      status,
      created_at,
      last_login_at
    FROM auth."user"
    WHERE user_id = ${userId}
    LIMIT 1
  `;

  let user: AdminUserDetail | null = null;
  let accountRow: UserAccountRow | null = null;

  if (coreRows.length > 0) {
    const base = coreRows[0] as {
      user_id: string;
      email: string;
      nickname: string | null;
      is_admin: boolean;
      status: "active" | "suspended" | "pending";
      created_at: string;
      last_login_at: string | null;
    };

    const [accountMatch] = await sql`
      SELECT
        user_id,
        email,
        nickname,
        is_admin,
        status,
        created_at,
        updated_at,
        last_login_at,
        invite_id
      FROM auth.user_account
      WHERE lower(email) = ${base.email.toLowerCase()}
      LIMIT 1
    `;

    if (accountMatch) {
      accountRow = accountMatch as UserAccountRow;
    }

    user = {
      user_id: base.user_id,
      email: base.email,
      nickname: accountRow?.nickname ?? base.nickname,
      is_admin: accountRow?.is_admin ?? base.is_admin,
      status: (accountRow?.status ??
        (base.status === "pending" ? "invited" : base.status)) as
        | "active"
        | "suspended"
        | "invited",
      created_at: base.created_at,
      updated_at: accountRow?.updated_at ?? base.created_at,
      last_login_at: base.last_login_at,
      invite_id: accountRow?.invite_id ?? null,
      source: "auth_user",
    };
  } else {
    const accountRows = await sql`
      SELECT
        user_id,
        email,
        nickname,
        is_admin,
        status,
        created_at,
        updated_at,
        last_login_at,
        invite_id
      FROM auth.user_account
      WHERE user_id = ${userId}
      LIMIT 1
    `;
    if (accountRows.length > 0) {
      const acct = accountRows[0] as {
        user_id: string;
        email: string;
        nickname: string | null;
        is_admin: boolean;
        status: "active" | "suspended" | "invited";
        created_at: string;
        updated_at: string;
        last_login_at: string | null;
        invite_id: string | null;
      };
      user = {
        ...acct,
        source: "user_account_only",
      };
    }
  }

  if (!user) notFound();

  let invite: any = null;
  if (user.invite_id) {
    const invRows = await sql`
      SELECT invite_id, email, token, status, expires_at, used_at, created_at
      FROM auth.invite_token
      WHERE invite_id = ${user.invite_id}
      LIMIT 1
    `;
    invite = invRows[0] ?? null;
  }

  // recent admin actions related to this user (target_email)
  const actions = (await sql`
    SELECT
      action_id,
      performed_email,
      action_type,
      action_scope,
      message,
      created_at
    FROM ops.admin_action_log
    WHERE target_email = ${user.email}
    ORDER BY created_at DESC
    LIMIT 50
  `) as Array<{
    action_id: string;
    performed_email: string | null;
    action_type: string;
    action_scope: string | null;
    message: string | null;
    created_at: string;
  }>;

  // settings snapshot (from your settings store)
  const settings = getUserSettings(user.email);

  const createdAt = new Date(user.created_at);
  const updatedAt = new Date(user.updated_at);
  const lastLogin = user.last_login_at ? new Date(user.last_login_at) : null;

  return (
    <div className="space-y-4">
      <header>
        <h2 className="text-sm font-semibold text-zinc-100">
          User detail
        </h2>
        <p className="text-xs text-zinc-400">
          Deep view into a single user account, including invite provenance and recent admin actions.
        </p>
      </header>

      {/* Core info */}
      <section className="rounded-lg border border-zinc-800 bg-zinc-950/80 px-4 py-3 text-xs">
        <p className="text-xs font-semibold text-zinc-300">Identity</p>
        <p className="mt-1 text-[11px] text-zinc-400">
          User ID:{" "}
          <span className="font-mono text-zinc-100">{user.user_id}</span>
        </p>
        <p className="mt-1 text-[11px] text-zinc-400">
          Email:{" "}
          <span className="font-mono text-emerald-200">{user.email}</span>
        </p>
        <p className="mt-1 text-[11px] text-zinc-400">
          Nickname:{" "}
          {user.nickname ? (
            <span className="font-mono text-zinc-100">{user.nickname}</span>
          ) : (
            <span className="text-zinc-500">—</span>
          )}
        </p>
        <p className="mt-1 text-[11px] text-zinc-400">
          Status:{" "}
          <span
            className={`inline-flex rounded-full px-2 py-[1px] text-[10px] font-medium ${
              user.status === "active"
                ? "bg-emerald-500/15 text-emerald-200"
                : user.status === "suspended"
                ? "bg-rose-500/15 text-rose-200"
                : "bg-amber-500/15 text-amber-200"
            }`}
          >
            {user.status}
          </span>
        </p>
        <p className="mt-1 text-[11px] text-zinc-400">
          Role: {user.is_admin ? "Admin" : "Regular"}
        </p>
        <p className="mt-2 text-[11px] text-zinc-500">
          Created: {createdAt.toLocaleString()}
        </p>
        <p className="text-[11px] text-zinc-500">
          Updated: {updatedAt.toLocaleString()}
        </p>
        <p className="text-[11px] text-zinc-500">
          Last login: {lastLogin ? lastLogin.toLocaleString() : "—"}
        </p>
      </section>

      {/* Invite provenance */}
      <section className="rounded-lg border border-zinc-800 bg-zinc-950/80 px-4 py-3 text-xs">
        <p className="text-xs font-semibold text-zinc-300">Invite</p>
        {invite ? (
          <div className="mt-1 space-y-1 text-[11px] text-zinc-400">
            <p>
              Invite ID:{" "}
              <span className="font-mono text-zinc-100">
                {invite.invite_id}
              </span>
            </p>
            <p>
              Token:{" "}
              <span className="font-mono text-zinc-300">{invite.token}</span>
            </p>
            <p>
              Status:{" "}
              <span className="font-mono text-emerald-200">
                {invite.status}
              </span>
            </p>
            <p>
              Expires at:{" "}
              {invite.expires_at
                ? new Date(invite.expires_at).toLocaleString()
                : "—"}
            </p>
            <p>
              Used at:{" "}
              {invite.used_at
                ? new Date(invite.used_at).toLocaleString()
                : "—"}
            </p>
          </div>
        ) : (
          <p className="mt-1 text-[11px] text-zinc-500">
            No invite linked to this user (maybe created manually).
          </p>
        )}
      </section>

      {/* Recent admin actions */}
      <section className="rounded-lg border border-zinc-800 bg-zinc-950/80 px-4 py-3 text-xs">
        <p className="text-xs font-semibold text-zinc-300">
          Recent admin actions on this user
        </p>
        {actions.length === 0 ? (
          <p className="mt-2 text-[11px] text-zinc-500">
            No admin actions recorded for this user yet.
          </p>
        ) : (
          <ul className="mt-2 space-y-1">
            {actions.map((a) => {
              const ts = new Date(a.created_at);
              return (
                <li
                  key={a.action_id}
                  className="flex flex-col gap-0.5 rounded-md border border-zinc-800 bg-black/50 px-2 py-1.5"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-mono text-[10px] text-zinc-400">
                      {ts.toLocaleString()}
                    </span>
                    <span className="text-[10px] text-zinc-400">
                      by{" "}
                      <span className="font-mono text-emerald-200">
                        {a.performed_email ?? "unknown"}
                      </span>
                    </span>
                  </div>
                  <div className="text-[11px] text-zinc-300">
                    <span className="font-mono text-emerald-200">
                      {a.action_scope ?? "global"}
                    </span>
                    <span className="text-zinc-500"> / </span>
                    <span className="font-mono">{a.action_type}</span>
                    {a.message && (
                      <>
                        <span className="text-zinc-500"> — </span>
                        <span>{a.message}</span>
                      </>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* Settings snapshot */}
      <section className="rounded-lg border border-zinc-800 bg-zinc-950/80 px-4 py-3 text-xs">
        <p className="text-xs font-semibold text-zinc-300">Settings snapshot</p>
        <p className="mt-1 text-[11px] text-zinc-400">
          Raw view from <span className="font-mono">getUserSettings</span> for this email.
        </p>
        <pre className="mt-2 max-h-60 overflow-auto rounded-md bg-black/60 p-2 text-[10px] text-zinc-300">
          {JSON.stringify(settings, null, 2)}
        </pre>
      </section>
    </div>
  );
}
