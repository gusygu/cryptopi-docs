import { sql } from "@/core/db/db";
import { requireUserSession } from "@/app/(server)/auth/session";
import { revalidatePath } from "next/cache";
import { logAdminAction } from "@/app/(server)/admin/log";

async function setUserAdmin(formData: FormData) {
  "use server";

  const session = await requireUserSession();
  if (!session.isAdmin) return;

  const userId = (formData.get("user_id") ?? "").toString();
  const makeAdmin = (formData.get("make_admin") ?? "").toString() === "true";
  if (!userId) return;

  await sql`
    UPDATE auth.user_account
    SET is_admin = ${makeAdmin}
    WHERE user_id = ${userId}
  `;

  await logAdminAction({
    actionType: "user.set_admin",
    actionScope: "users",
    targetUserId: userId,
    message: `${session.email} set is_admin=${makeAdmin} on user ${userId}`,
  });

  revalidatePath("/admin/users");
}

async function setUserStatus(formData: FormData) {
  "use server";

  const session = await requireUserSession();
  if (!session.isAdmin) return;

  const userId = (formData.get("user_id") ?? "").toString();
  const newStatus = (formData.get("status") ?? "").toString();
  if (!userId) return;
  if (!["active", "suspended", "invited"].includes(newStatus)) return;

  await sql`
    UPDATE auth.user_account
    SET status = ${newStatus}
    WHERE user_id = ${userId}
  `;

  await logAdminAction({
    actionType: "user.set_status",
    actionScope: "users",
    targetUserId: userId,
    message: `${session.email} set status=${newStatus} on user ${userId}`,
  });

  revalidatePath("/admin/users");
}


export default async function AdminUsersPage() {
  const session = await requireUserSession();
  if (!session.isAdmin) {
    // layout already guards, this is belt + suspenders
    return null;
  }

  const rows = await sql`
    SELECT
      user_id,
      email,
      nickname,
      is_admin,
      status,
      created_at,
      last_login_at
    FROM auth.user_account
    ORDER BY created_at DESC
    LIMIT 200
  `;

  const users = rows as Array<{
    user_id: string;
    email: string;
    nickname: string | null;
    is_admin: boolean;
    status: "active" | "suspended" | "invited";
    created_at: string;
    last_login_at: string | null;
  }>;

  return (
    <div className="space-y-4">
      <header>
        <h2 className="text-sm font-semibold text-zinc-100">Users</h2>
        <p className="text-xs text-zinc-400">
          Manage user roles and status. These actions are restricted to admins.
        </p>
      </header>

      <div className="overflow-x-auto rounded-lg border border-zinc-800 bg-zinc-950/80">
        <table className="min-w-full text-xs">
          <thead className="bg-zinc-900/80 text-zinc-300">
            <tr>
              <th className="px-3 py-2 text-left font-medium">Email</th>
              <th className="px-3 py-2 text-left font-medium">Nickname</th>
              <th className="px-3 py-2 text-left font-medium">Status</th>
              <th className="px-3 py-2 text-left font-medium">Admin</th>
              <th className="px-3 py-2 text-left font-medium">Created</th>
              <th className="px-3 py-2 text-left font-medium">Last login</th>
              <th className="px-3 py-2 text-left font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {users.length === 0 && (
              <tr>
                <td
                  colSpan={7}
                  className="px-3 py-4 text-center text-zinc-500"
                >
                  No users found.
                </td>
              </tr>
            )}

            {users.map((u) => {
              const createdAt = new Date(u.created_at);
              const lastLogin = u.last_login_at
                ? new Date(u.last_login_at)
                : null;

              const canDemoteSelf =
                session.email.toLowerCase() === u.email.toLowerCase();

              return (
                <tr key={u.user_id} className="border-t border-zinc-800">
                  <td className="px-3 py-2 font-mono text-[11px]">
                    {u.email}
                  </td>
                  <td className="px-3 py-2 text-[11px]">
                    {u.nickname || <span className="text-zinc-500">—</span>}
                  </td>
                  <td className="px-3 py-2 text-[11px]">
                    <span
                      className={`inline-flex rounded-full px-2 py-[1px] text-[10px] font-medium ${
                        u.status === "active"
                          ? "bg-emerald-500/15 text-emerald-200"
                          : u.status === "suspended"
                          ? "bg-rose-500/15 text-rose-200"
                          : "bg-amber-500/15 text-amber-200"
                      }`}
                    >
                      {u.status}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-[11px]">
                    {u.is_admin ? (
                      <span className="rounded-full bg-emerald-500/20 px-2 py-[1px] text-[10px] text-emerald-100">
                        admin
                      </span>
                    ) : (
                      <span className="text-zinc-500 text-[10px]">regular</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-[11px] text-zinc-400">
                    {createdAt.toLocaleString()}
                  </td>
                  <td className="px-3 py-2 text-[11px] text-zinc-400">
                    {lastLogin ? (
                      lastLogin.toLocaleString()
                    ) : (
                      <span className="text-zinc-500">—</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-[11px]">
                    <div className="flex flex-wrap items-center gap-1.5">
                      {/* Admin toggle */}
                      <form action={setUserAdmin}>
                        <input type="hidden" name="user_id" value={u.user_id} />
                        <input
                          type="hidden"
                          name="make_admin"
                          value={u.is_admin ? "false" : "true"}
                        />
                        <button
                          type="submit"
                          className={`rounded-md border px-2 py-[2px] text-[10px] ${
                            u.is_admin
                              ? "border-amber-500/60 bg-amber-600/15 text-amber-100 hover:bg-amber-600/25"
                              : "border-emerald-500/60 bg-emerald-600/20 text-emerald-100 hover:bg-emerald-600/30"
                          }`}
                        >
                          {u.is_admin ? "Remove admin" : "Make admin"}
                        </button>
                      </form>

                      {/* Status toggle: active <-> suspended */}
                      <form action={setUserStatus}>
                        <input type="hidden" name="user_id" value={u.user_id} />
                        <input
                          type="hidden"
                          name="status"
                          value={u.status === "suspended" ? "active" : "suspended"}
                        />
                        <button
                          type="submit"
                          className={`rounded-md border px-2 py-[2px] text-[10px] ${
                            u.status === "suspended"
                              ? "border-emerald-500/60 bg-emerald-600/20 text-emerald-100 hover:bg-emerald-600/30"
                              : "border-rose-500/60 bg-rose-600/15 text-rose-100 hover:bg-rose-600/25"
                          }`}
                        >
                          {u.status === "suspended" ? "Activate" : "Suspend"}
                        </button>
                      </form>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
