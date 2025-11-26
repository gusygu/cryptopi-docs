import { sql } from "@/core/db/db";
import { requireUserSession } from "@/app/(server)/auth/session";

export default async function AdminJobsPage() {
  const session = await requireUserSession();
  if (!session.isAdmin) return null;

  const rows = await sql`
    SELECT
      run_id,
      job_name,
      job_type,
      status,
      started_at,
      finished_at,
      duration_ms,
      error_message
    FROM ops.job_run
    ORDER BY started_at DESC
    LIMIT 200
  `;

  const runs = rows as Array<{
    run_id: string;
    job_name: string;
    job_type: string | null;
    status: "success" | "error" | "running" | "queued" | "skipped";
    started_at: string;
    finished_at: string | null;
    duration_ms: number | null;
    error_message: string | null;
  }>;

  return (
    <div className="space-y-4">
      <header>
        <h2 className="text-sm font-semibold text-zinc-100">
          Jobs & ingest runs
        </h2>
        <p className="text-xs text-zinc-400">
          Recent runs for ingest / maintenance jobs, as recorded by ops.job_run.
        </p>
      </header>

      <div className="overflow-x-auto rounded-lg border border-zinc-800 bg-zinc-950/80">
        <table className="min-w-full text-xs">
          <thead className="bg-zinc-900/80 text-zinc-300">
            <tr>
              <th className="px-3 py-2 text-left">Job</th>
              <th className="px-3 py-2 text-left">Type</th>
              <th className="px-3 py-2 text-left">Status</th>
              <th className="px-3 py-2 text-left">Started</th>
              <th className="px-3 py-2 text-left">Duration</th>
              <th className="px-3 py-2 text-left">Error</th>
            </tr>
          </thead>
          <tbody>
            {runs.length === 0 ? (
              <tr>
                <td
                  className="px-3 py-4 text-center text-zinc-500"
                  colSpan={6}
                >
                  No job runs recorded yet.
                </td>
              </tr>
            ) : (
              runs.map((r) => {
                const started = new Date(r.started_at);
                const statusTone =
                  r.status === "success"
                    ? "bg-emerald-500/15 text-emerald-200"
                    : r.status === "error"
                    ? "bg-rose-500/15 text-rose-200"
                    : r.status === "running"
                    ? "bg-sky-500/15 text-sky-200"
                    : "bg-zinc-600/15 text-zinc-200";

                return (
                  <tr key={r.run_id} className="border-t border-zinc-800">
                    <td className="px-3 py-2 text-[11px] text-zinc-100">
                      <span className="font-mono">{r.job_name}</span>
                    </td>
                    <td className="px-3 py-2 text-[11px] text-zinc-400">
                      {r.job_type ?? <span className="text-zinc-500">—</span>}
                    </td>
                    <td className="px-3 py-2 text-[11px]">
                      <span
                        className={`inline-flex rounded-full px-2 py-[1px] text-[10px] font-medium ${statusTone}`}
                      >
                        {r.status}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-[11px] text-zinc-400">
                      {started.toLocaleString()}
                    </td>
                    <td className="px-3 py-2 text-[11px] text-zinc-400">
                      {r.duration_ms != null
                        ? `${r.duration_ms} ms`
                        : r.finished_at
                        ? "—"
                        : "running"}
                    </td>
                    <td className="px-3 py-2 text-[11px] text-rose-300">
                      {r.error_message ? (
                        <span className="line-clamp-2">{r.error_message}</span>
                      ) : (
                        <span className="text-zinc-500">—</span>
                      )}
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
