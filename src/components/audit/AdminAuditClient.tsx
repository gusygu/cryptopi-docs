'use client';

import { useCallback, useEffect, useState } from "react";

type AdminActivity = {
  audit_id: string;
  user_id: string;
  event: string;
  details: Record<string, unknown> | null;
  created_at: string;
};

type AdminError = {
  error_id: string;
  owner_user_id: string | null;
  cycle_seq: number | null;
  summary: string;
  details: Record<string, unknown> | null;
  status: string;
  created_at: string;
};

type AdminReport = {
  report_id: string;
  owner_user_id: string;
  cycle_seq: number | null;
  category: string;
  severity: string;
  note: string | null;
  created_at: string;
  acknowledged_by: string | null;
  acknowledged_at: string | null;
};

type VitalsLog = {
  vitals_id: string;
  snapshot_ts: string;
  payload: Record<string, unknown>;
};

export default function AdminAuditClient() {
  const [activities, setActivities] = useState<AdminActivity[]>([]);
  const [errors, setErrors] = useState<AdminError[]>([]);
  const [reports, setReports] = useState<AdminReport[]>([]);
  const [vitals, setVitals] = useState<VitalsLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    setErrorMsg(null);
    try {
      const [activityRes, errorsRes, reportsRes, vitalsRes] = await Promise.all([
        fetch("/api/admin/audit/activity", { cache: "no-store" }),
        fetch("/api/admin/audit/errors", { cache: "no-store" }),
        fetch("/api/admin/audit/reports", { cache: "no-store" }),
        fetch("/api/admin/audit/vitals", { cache: "no-store" }),
      ]);
      if (!activityRes.ok || !errorsRes.ok || !reportsRes.ok || !vitalsRes.ok) {
        throw new Error("Failed to load admin audit data");
      }
      const [activityJson, errorsJson, reportsJson, vitalsJson] = await Promise.all([
        activityRes.json(),
        errorsRes.json(),
        reportsRes.json(),
        vitalsRes.json(),
      ]);
      if (!activityJson?.ok || !errorsJson?.ok || !reportsJson?.ok || !vitalsJson?.ok) {
        throw new Error("Audit endpoints returned an error");
      }
      setActivities(Array.isArray(activityJson.items) ? activityJson.items : []);
      setErrors(Array.isArray(errorsJson.items) ? errorsJson.items : []);
      setReports(Array.isArray(reportsJson.items) ? reportsJson.items : []);
      setVitals(Array.isArray(vitalsJson.items) ? vitalsJson.items : []);
    } catch (err: any) {
      setErrorMsg(err?.message ?? "Failed to load admin audit data");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-lg font-semibold text-zinc-100">Admin audit dashboard</h1>
          <p className="text-xs text-zinc-500">
            Track system vitals, error queue, user activity, and the mini-letters sent by the community.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void loadData()}
          className="rounded-md border border-emerald-500/40 px-3 py-1 text-sm text-emerald-200 hover:border-emerald-400 disabled:opacity-50"
          disabled={loading}
        >
          {loading ? "Refreshing…" : "Refresh"}
        </button>
      </header>

      {errorMsg && (
        <div className="rounded-md border border-rose-600/50 bg-rose-950/40 px-4 py-3 text-sm text-rose-100">
          {errorMsg}
        </div>
      )}

      <section className="grid gap-4 md:grid-cols-3">
        <MetricCard label="Open error queue" value={errors.length} />
        <MetricCard label="Mini-letters" value={reports.length} />
        <MetricCard label="Vitals snapshots" value={vitals.length} />
      </section>

      <SectionCard title="System vitals snapshots">
        <div className="space-y-3 text-xs">
          {vitals.slice(0, 5).map((entry) => (
            <div key={entry.vitals_id} className="rounded-lg border border-zinc-800 bg-zinc-950/60 px-3 py-2">
              <div className="flex items-center justify-between text-[11px] text-zinc-500">
                <span>#{entry.vitals_id.slice(0, 8)}</span>
                <span>{formatDate(entry.snapshot_ts)}</span>
              </div>
              <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap text-[11px] text-zinc-200">
                {JSON.stringify(entry.payload ?? {}, null, 2)}
              </pre>
            </div>
          ))}
          {vitals.length === 0 && <p className="text-zinc-500">No vitals snapshots yet.</p>}
        </div>
      </SectionCard>

      <SectionCard title="Error queue">
        <div className="overflow-x-auto rounded-lg border border-zinc-900">
          <table className="min-w-full text-left text-xs text-zinc-300">
            <thead className="bg-zinc-900/70 text-[11px] uppercase tracking-wide text-zinc-500">
              <tr>
                <th className="px-3 py-2">ID</th>
                <th className="px-3 py-2">Owner</th>
                <th className="px-3 py-2">Cycle</th>
                <th className="px-3 py-2">Summary</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2">Timestamp</th>
              </tr>
            </thead>
            <tbody>
              {errors.slice(0, 12).map((entry) => (
                <tr key={entry.error_id} className="border-t border-zinc-900/70">
                  <td className="px-3 py-2 font-mono">{entry.error_id.slice(0, 8)}</td>
                  <td className="px-3 py-2">{entry.owner_user_id ?? "n/a"}</td>
                  <td className="px-3 py-2">{entry.cycle_seq ?? "—"}</td>
                  <td className="px-3 py-2 text-zinc-200">{entry.summary}</td>
                  <td className="px-3 py-2">
                    <span className={`rounded px-2 py-[2px] text-[10px] font-semibold ${statusBadge(entry.status)}`}>
                      {entry.status.toUpperCase()}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-zinc-400">{formatDate(entry.created_at)}</td>
                </tr>
              ))}
              {errors.length === 0 && (
                <tr>
                  <td className="px-3 py-4 text-center text-zinc-500" colSpan={6}>
                    No errors queued.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </SectionCard>

      <SectionCard title="Mini-letters from users">
        <div className="space-y-3 text-sm">
          {reports.slice(0, 10).map((entry) => (
            <div key={entry.report_id} className="rounded-lg border border-zinc-800 bg-zinc-950/60 px-3 py-2">
              <div className="flex items-center justify-between text-xs text-zinc-500">
                <span className="font-mono text-zinc-300">{entry.owner_user_id.slice(0, 8)}</span>
                <span>{formatDate(entry.created_at)}</span>
              </div>
              <div className="mt-1 text-[11px] text-zinc-400">
                #{entry.cycle_seq ?? "n/a"} · {entry.category} · {entry.severity}
              </div>
              <p className="mt-1 text-sm text-zinc-100">{entry.note || "—"}</p>
              {entry.acknowledged_at && (
                <p className="text-[11px] text-emerald-300">
                  Acknowledged at {formatDate(entry.acknowledged_at)}
                </p>
              )}
            </div>
          ))}
          {reports.length === 0 && <p className="text-xs text-zinc-500">No pending mini-letters.</p>}
        </div>
      </SectionCard>

      <SectionCard title="Recent admin activity">
        <div className="overflow-x-auto rounded-lg border border-zinc-900">
          <table className="min-w-full text-left text-xs text-zinc-300">
            <thead className="bg-zinc-900/70 text-[11px] uppercase tracking-wide text-zinc-500">
              <tr>
                <th className="px-3 py-2">Event</th>
                <th className="px-3 py-2">User</th>
                <th className="px-3 py-2">Details</th>
                <th className="px-3 py-2">Timestamp</th>
              </tr>
            </thead>
            <tbody>
              {activities.slice(0, 10).map((entry) => (
                <tr key={entry.audit_id} className="border-t border-zinc-900/70">
                  <td className="px-3 py-2 text-zinc-100">{entry.event}</td>
                  <td className="px-3 py-2">{entry.user_id}</td>
                  <td className="px-3 py-2 text-zinc-400">
                    {entry.details ? JSON.stringify(entry.details) : "—"}
                  </td>
                  <td className="px-3 py-2 text-zinc-400">{formatDate(entry.created_at)}</td>
                </tr>
              ))}
              {activities.length === 0 && (
                <tr>
                  <td className="px-3 py-4 text-center text-zinc-500" colSpan={4}>
                    No admin activity captured yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </SectionCard>
    </div>
  );
}

function SectionCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-zinc-800 bg-zinc-950/60 p-4">
      <h2 className="text-sm font-semibold text-zinc-100">{title}</h2>
      <div className="mt-3">{children}</div>
    </section>
  );
}

function MetricCard({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-950/60 px-4 py-3">
      <p className="text-xs uppercase tracking-wide text-zinc-500">{label}</p>
      <p className="mt-1 text-2xl font-semibold text-zinc-100">{value}</p>
    </div>
  );
}

function statusBadge(status: string) {
  if (status === "error" || status === "open") {
    return "bg-rose-900/40 text-rose-200 border border-rose-700/60";
  }
  if (status === "warn") return "bg-amber-900/30 text-amber-200 border border-amber-600/40";
  if (status === "resolved") return "bg-emerald-900/30 text-emerald-200 border border-emerald-600/50";
  return "bg-zinc-900 text-zinc-300 border border-zinc-800";
}

function formatDate(input?: string | null) {
  if (!input) return "—";
  try {
    return new Date(input).toLocaleString();
  } catch {
    return input;
  }
}
