import { sql } from "@/core/db/db";
import { requireUserSession } from "@/app/(server)/auth/session";

export default async function AdminActionsPage() {
  const session = await requireUserSession();
  if (!session.isAdmin) return null;

  const rows = await sql`
    SELECT
      action_id,
      performed_email,
      target_email,
      action_type,
      action_scope,
      message,
      meta,
      created_at
    FROM ops.admin_action_log
    ORDER BY created_at DESC
    LIMIT 200
  `;

  const actions = rows as Array<{
    action_id: string;
    performed_email: string | null;
    target_email: string | null;
    action_type: string;
    action_scope: string | null;
    message: string | null;
    meta: any;
    created_at: string;
  }>;

  return (
    <div className="space-y-4">
      <header>
        <h2 className="text-sm font-semibold text-zinc-100">Admin actions</h2>
        <p className="text-xs text-zinc-400">
          Recent high-level actions taken by admins (role changes, invite decisions, etc.).
        </p>
      </header>

      <div className="overflow-x-auto rounded-lg border border-zinc-800 bg-zinc-950/80">
        <table className="min-w-full text-xs">
          <thead className="bg-zinc-900/80 text-zinc-300">
            <tr>
              <th className="px-3 py-2 text-left">When</th>
              <th className="px-3 py-2 text-left">Action</th>
              <th className="px-3 py-2 text-left">Performed by</th>
              <th className="px-3 py-2 text-left">Target</th>
              <th className="px-3 py-2 text-left">Message</th>
            </tr>
          </thead>
          <tbody>
            {actions.length === 0 ? (
              <tr>
                <td
                  className="px-3 py-4 text-center text-zinc-500"
                  colSpan={5}
                >
                  No actions logged yet.
                </td>
              </tr>
            ) : (
              actions.map((a) => {
                const ts = new Date(a.created_at);
                return (
                  <tr key={a.action_id} className="border-t border-zinc-800">
                    <td className="px-3 py-2 text-[11px] text-zinc-400">
                      {ts.toLocaleString()}
                    </td>
                    <td className="px-3 py-2 text-[11px]">
                      <span className="font-mono text-emerald-200">
                        {a.action_scope ?? "global"}
                      </span>
                      <span className="text-zinc-500"> / </span>
                      <span className="font-mono text-zinc-100">
                        {a.action_type}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-[11px] text-zinc-300">
                      {a.performed_email ?? <span className="text-zinc-500">—</span>}
                    </td>
                    <td className="px-3 py-2 text-[11px] text-zinc-300">
                      {a.target_email ?? <span className="text-zinc-500">—</span>}
                    </td>
                    <td className="px-3 py-2 text-[11px] text-zinc-300">
                      {a.message ?? <span className="text-zinc-500">—</span>}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
