import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { sql } from "@/core/db/db";
import { requireUserSession } from "@/app/(server)/auth/session";

async function suspendAccount(formData: FormData) {
  "use server";

  const session = await requireUserSession();

  // Mark user as suspended
  await sql`
    UPDATE auth.user_account
    SET status = 'suspended', updated_at = now()
    WHERE lower(email) = ${session.email.toLowerCase()}
  `;

  // Clear session cookie
  const jar = await cookies();
  jar.set("session", "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    expires: new Date(0),
  });

  redirect("/auth?ok=account_suspended");
}

export default async function SecurityPage() {
  const session = await requireUserSession();

  const rows = await sql`
    SELECT email, nickname, is_admin, status, created_at, last_login_at
    FROM auth.user_account
    WHERE lower(email) = ${session.email.toLowerCase()}
    LIMIT 1
  `;

  const user =
    rows[0] ??
    ({
      email: session.email,
      nickname: session.nickname,
      is_admin: session.isAdmin,
      status: "active",
      created_at: null,
      last_login_at: null,
    } as any);

  const createdAt = user.created_at ? new Date(user.created_at) : null;
  const lastLogin = user.last_login_at ? new Date(user.last_login_at) : null;

  const statusLabel =
    user.status === "active"
      ? "Active"
      : user.status === "suspended"
      ? "Suspended"
      : "Invited";

  return (
    <main className="mx-auto max-w-xl px-4 py-8">
      <h1 className="text-lg font-semibold text-zinc-50">Security</h1>
      <p className="mb-6 text-sm text-zinc-400">
        View your account status and manage destructive actions.
      </p>

      <section className="mb-6 space-y-2 rounded-lg border border-zinc-800 bg-zinc-950/80 px-4 py-3 text-sm">
        <p className="text-xs font-semibold text-zinc-300">Account</p>
        <p className="text-xs text-zinc-400">
          Email:{" "}
          <span className="font-mono text-zinc-100">{user.email}</span>
        </p>
        <p className="text-xs text-zinc-400">
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
            {statusLabel}
          </span>
        </p>
        <p className="text-xs text-zinc-500">
          Member since:{" "}
          {createdAt ? createdAt.toLocaleString() : "—"}
        </p>
        <p className="text-xs text-zinc-500">
          Last login:{" "}
          {lastLogin ? lastLogin.toLocaleString() : "—"}
        </p>
        <p className="text-xs text-zinc-500">
          Role:{" "}
          {user.is_admin ? "Admin" : "Regular user"}
        </p>
      </section>

      <section className="space-y-3 rounded-lg border border-rose-800 bg-rose-950/70 px-4 py-4">
        <p className="text-xs font-semibold text-rose-100">
          Dangerous actions
        </p>
        <p className="text-xs text-rose-200/90">
          Suspending your account will log you out and mark your account as
          inactive. An admin can later reactivate it from the admin dashboard.
        </p>

        <form action={suspendAccount}>
          <button
            type="submit"
            className="mt-2 inline-flex items-center rounded-md border border-rose-500/60 bg-rose-600/30 px-3 py-1.5 text-xs font-medium text-rose-50 hover:bg-rose-600/45"
          >
            Suspend my account
          </button>
        </form>
      </section>
    </main>
  );
}
