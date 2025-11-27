import { sql } from "@/core/db/db";
import { requireUserSession } from "@/app/(server)/auth/session";
import Link from "next/link";

export default async function AdminDashboardPage() {
  const session = await requireUserSession();
  if (!session.isAdmin) {
    // hard-block non-admins
    return (
      <main className="flex min-h-[60vh] items-center justify-center bg-black">
        <div className="rounded-xl border border-rose-800 bg-rose-950/70 px-6 py-5 text-sm text-rose-100">
          <p className="font-semibold">Access denied</p>
          <p className="mt-1 text-xs text-rose-200/80">
            You need admin privileges to access this area.
          </p>
        </div>
      </main>
    );
  }

  // fetch some quick stats
  const [userStats] = await sql`
    SELECT
      count(*)::int AS total_users,
      count(*) FILTER (WHERE is_admin)::int AS admin_users,
      count(*) FILTER (WHERE status = 'suspended')::int AS suspended_users,
      count(*) FILTER (WHERE status = 'pending')::int AS pending_users
    FROM auth."user"
  `;

  const [inviteStats] = await sql`
    SELECT
      count(*)::int AS total_requests,
      count(*) FILTER (WHERE status = 'pending')::int AS pending_requests,
      count(*) FILTER (WHERE status = 'approved')::int AS approved_requests,
      count(*) FILTER (WHERE status = 'rejected')::int AS rejected_requests
    FROM auth.invite_request
  `;

  return (
    <main className="mx-auto flex min-h-[80vh] w-full max-w-5xl flex-col gap-6 px-4 py-6 text-sm text-zinc-100">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold text-zinc-50">
            Admin dashboard
          </h1>
          <p className="text-xs text-zinc-400">
            Overview of users and invite flow for CryptoPi Dynamics.
          </p>
        </div>
        <div className="flex items-center gap-2 text-xs text-zinc-400">
          <span className="rounded-full border border-emerald-500/50 bg-emerald-600/20 px-2 py-[2px] font-mono text-[11px] text-emerald-100">
            {session.nickname || session.email}
          </span>
          <span className="text-zinc-600">/</span>
          <Link
            href="/"
            className="text-emerald-300 underline-offset-2 hover:underline"
          >
            Back to app
          </Link>
        </div>
      </header>

      {/* Stats cards */}
      <section className="grid gap-4 md:grid-cols-3">
        <div className="rounded-lg border border-zinc-800 bg-zinc-950/80 px-4 py-3">
          <p className="text-xs text-zinc-400">Users</p>
          <p className="mt-1 text-2xl font-semibold text-zinc-50">
            {userStats?.total_users ?? 0}
          </p>
          <p className="mt-1 text-[11px] text-zinc-500">
            Admins:{" "}
            <span className="font-mono">
              {userStats?.admin_users ?? 0}
            </span>
          </p>
          <p className="mt-1 text-[11px] text-zinc-500">
            Suspended:{" "}
            <span className="font-mono">
              {userStats?.suspended_users ?? 0}
            </span>
          </p>
          <p className="mt-1 text-[11px] text-zinc-500">
            Pending:{" "}
            <span className="font-mono">
              {userStats?.pending_users ?? 0}
            </span>
          </p>
        </div>

        <div className="rounded-lg border border-zinc-800 bg-zinc-950/80 px-4 py-3">
          <p className="text-xs text-zinc-400">Invite requests</p>
          <p className="mt-1 text-2xl font-semibold text-zinc-50">
            {inviteStats?.total_requests ?? 0}
          </p>
          <p className="mt-1 text-[11px] text-zinc-500">
            Pending:{" "}
            <span className="font-mono">
              {inviteStats?.pending_requests ?? 0}
            </span>
          </p>
        </div>

        <div className="rounded-lg border border-zinc-800 bg-zinc-950/80 px-4 py-3">
          <p className="text-xs text-zinc-400">Invites status</p>
          <p className="mt-1 text-[11px] text-zinc-400">
            Approved:{" "}
            <span className="font-mono">
              {inviteStats?.approved_requests ?? 0}
            </span>
          </p>
          <p className="mt-1 text-[11px] text-zinc-400">
            Rejected:{" "}
            <span className="font-mono">
              {inviteStats?.rejected_requests ?? 0}
            </span>
          </p>
        </div>
      </section>

      {/* Quick navigation */}
      <section className="rounded-lg border border-zinc-800 bg-zinc-950/80 px-4 py-4">
        <h2 className="text-sm font-semibold text-zinc-100">
          Admin sections
        </h2>
        <ul className="mt-3 space-y-2 text-xs">
          <li>
            <Link
              href="/admin/invites"
              className="inline-flex items-center gap-1 rounded-md border border-emerald-500/50 bg-emerald-600/15 px-2 py-1 text-emerald-100 hover:bg-emerald-600/25"
            >
              Invite requests
              <span className="text-[10px] text-emerald-200/80">
                ({inviteStats?.pending_requests ?? 0} pending)
              </span>
            </Link>
          </li>
          <li>
            <Link
              href="/admin/users"
              className="inline-flex items-center gap-1 rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1 text-zinc-200 hover:border-emerald-500/50 hover:text-emerald-200"
            >
              Users (soon)
            </Link>
          </li>
        </ul>
      </section>
    </main>
  );
}
