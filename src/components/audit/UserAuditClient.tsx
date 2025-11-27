'use client';

import { useCallback, useEffect, useMemo, useState } from "react";

type AuditCycle = {
  cycle_seq: number;
  status: string;
  summary: string;
  payload?: Record<string, unknown> | null;
  created_at: string;
};

type SamplingLog = {
  sampling_log_id?: string;
  cycle_seq: number | null;
  symbol: string;
  window_label: string;
  status: string;
  sample_ts: string | null;
  message?: string | null;
  meta?: Record<string, unknown> | null;
  created_at: string;
};

type ReportState = {
  cycleSeq: string;
  category: string;
  severity: string;
  note: string;
  submitting: boolean;
  error: string | null;
  success: string | null;
};

const initialReportState: ReportState = {
  cycleSeq: "",
  category: "issue",
  severity: "medium",
  note: "",
  submitting: false,
  error: null,
  success: null,
};

export default function UserAuditClient() {
  const [cycles, setCycles] = useState<AuditCycle[]>([]);
  const [sampling, setSampling] = useState<SamplingLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [filterSeq, setFilterSeq] = useState("");
  const [report, setReport] = useState<ReportState>(initialReportState);

  const loadData = useCallback(async () => {
    setLoading(true);
    setErrorMsg(null);
    try {
      const [cyclesRes, samplingRes] = await Promise.all([
        fetch("/api/audit/cycles", { cache: "no-store" }),
        fetch("/api/audit/sampling", { cache: "no-store" }),
      ]);
      if (!cyclesRes.ok) {
        throw new Error("Failed to load audit cycles");
      }
      if (!samplingRes.ok) {
        throw new Error("Failed to load sampling history");
      }
      const cyclesJson = await cyclesRes.json();
      const samplingJson = await samplingRes.json();
      if (!cyclesJson?.ok) {
        throw new Error(cyclesJson?.error ?? "Failed to load audit cycles");
      }
      if (!samplingJson?.ok) {
        throw new Error(samplingJson?.error ?? "Failed to load sampling history");
      }
      setCycles(Array.isArray(cyclesJson.items) ? cyclesJson.items : []);
      setSampling(Array.isArray(samplingJson.items) ? samplingJson.items : []);
    } catch (err: any) {
      setErrorMsg(err?.message ?? "Audit data failed to load");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const filteredCycles = useMemo(() => {
    const query = filterSeq.trim();
    if (!query) return cycles;
    return cycles.filter((cycle) => String(cycle.cycle_seq) === query);
  }, [cycles, filterSeq]);

  const latestIssue = useMemo(
    () => cycles.find((cycle) => cycle.status === "error" || cycle.status === "warn"),
    [cycles],
  );

  const handleReportSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!report.note.trim()) {
      setReport((state) => ({ ...state, error: "Add a short description before sending." }));
      return;
    }
    setReport((state) => ({ ...state, submitting: true, error: null, success: null }));
    try {
      const cycleSeqValue = Number(report.cycleSeq);
      const payload = {
        cycleSeq: Number.isFinite(cycleSeqValue) ? cycleSeqValue : undefined,
        category: report.category,
        severity: report.severity,
        note: report.note.trim(),
      };
      const res = await fetch("/api/audit/report", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        throw new Error("Failed to send report");
      }
      setReport((state) => ({
        ...initialReportState,
        success: "Report sent to the admins. We'll follow up soon.",
      }));
    } catch (err: any) {
      setReport((state) => ({
        ...state,
        submitting: false,
        error: err?.message ?? "Failed to send your report",
      }));
    } finally {
      setReport((state) => ({ ...state, submitting: false }));
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-lg font-semibold text-zinc-100">Audit trail</h1>
            <p className="text-xs text-zinc-500">
              Review your recent cycles, sampling snapshots, and send mini-letters to the admin team.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <input
              value={filterSeq}
              onChange={(event) => setFilterSeq(event.target.value)}
              placeholder="Filter by cycle #"
              className="rounded-md border border-zinc-700 bg-zinc-900 px-3 py-1 text-sm text-zinc-200 placeholder:text-zinc-500 focus:border-emerald-400 focus:outline-none"
            />
            <button
              type="button"
              onClick={() => void loadData()}
              className="rounded-md border border-emerald-500/40 px-3 py-1 text-sm text-emerald-200 hover:border-emerald-400"
              disabled={loading}
            >
              Refresh
            </button>
          </div>
      </header>

      {errorMsg && (
        <div className="rounded-md border border-rose-600/50 bg-rose-950/40 px-4 py-3 text-sm text-rose-100">
          {errorMsg}
        </div>
      )}

      <section className="grid gap-4 md:grid-cols-3">
        <MetricCard label="Total cycles" value={cycles.length} />
        <MetricCard label="Last cycle" value={cycles[0]?.cycle_seq ?? "-"} hint={cycles[0]?.status} />
        <MetricCard
          label="Issues spotted"
          value={cycles.filter((cycle) => cycle.status !== "ok" && cycle.status !== "idle").length}
          hint={latestIssue ? `Latest: #${latestIssue.cycle_seq}` : "All clear"}
        />
      </section>

      <section className="rounded-xl border border-zinc-800 bg-zinc-950/60 p-4">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-zinc-100">Cycle timeline</h2>
          {loading && <span className="text-xs text-zinc-500">Loading…</span>}
        </div>
        <div className="mt-3 space-y-2 text-sm">
          {filteredCycles.length === 0 && !loading && (
            <p className="text-xs text-zinc-500">No cycles logged yet.</p>
          )}
          {filteredCycles.slice(0, 40).map((cycle) => (
            <div
              key={`${cycle.cycle_seq}-${cycle.created_at}`}
              className="rounded-lg border border-zinc-800/80 bg-zinc-900/40 px-3 py-2"
            >
              <div className="flex items-center justify-between text-xs text-zinc-400">
                <span className="font-mono text-sm text-zinc-200">#{cycle.cycle_seq}</span>
                <span>{formatDate(cycle.created_at)}</span>
              </div>
              <div className="mt-1 text-sm text-zinc-100">{cycle.summary || "—"}</div>
              <span className={`mt-1 inline-flex rounded px-2 py-[2px] text-[10px] font-semibold ${statusBadge(cycle.status)}`}>
                {cycle.status.toUpperCase()}
              </span>
            </div>
          ))}
        </div>
      </section>

      <section className="rounded-xl border border-zinc-800 bg-zinc-950/60 p-4">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-zinc-100">STR-aux sampling log</h2>
          <span className="text-xs text-zinc-500">Latest {sampling.slice(0, 12).length} events</span>
        </div>
        <div className="mt-3 overflow-x-auto rounded-lg border border-zinc-900">
          <table className="min-w-full text-left text-xs text-zinc-300">
            <thead className="bg-zinc-900/70 text-[11px] uppercase tracking-wide text-zinc-500">
              <tr>
                <th className="px-3 py-2">Cycle</th>
                <th className="px-3 py-2">Symbol</th>
                <th className="px-3 py-2">Window</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2">Note</th>
                <th className="px-3 py-2">At</th>
              </tr>
            </thead>
            <tbody>
              {sampling.slice(0, 12).map((entry) => (
                <tr key={`${entry.symbol}-${entry.created_at}`} className="border-t border-zinc-900/60">
                  <td className="px-3 py-2 font-mono text-sm text-zinc-200">
                    {entry.cycle_seq ?? "—"}
                  </td>
                  <td className="px-3 py-2">{entry.symbol}</td>
                  <td className="px-3 py-2">{entry.window_label}</td>
                  <td className="px-3 py-2">
                    <span className={`rounded px-2 py-[2px] text-[10px] font-semibold ${statusBadge(entry.status)}`}>
                      {entry.status.toUpperCase()}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-zinc-400">{entry.message || "—"}</td>
                  <td className="px-3 py-2 text-zinc-400">{formatDate(entry.sample_ts ?? entry.created_at)}</td>
                </tr>
              ))}
              {sampling.length === 0 && (
                <tr>
                  <td className="px-3 py-4 text-center text-zinc-500" colSpan={6}>
                    Sampling log is empty for now.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="rounded-xl border border-zinc-800 bg-zinc-950/60 p-4">
        <h2 className="text-sm font-semibold text-zinc-100">Notify admin (mini-letter)</h2>
        <p className="text-xs text-zinc-500">
          Share a quick note when you spot something unusual. Cycle # helps the team trace the issue faster.
        </p>
        <form onSubmit={handleReportSubmit} className="mt-4 space-y-3">
          <div className="flex flex-wrap gap-3">
            <label className="flex-1 min-w-[160px] text-xs text-zinc-400">
              Cycle #
              <input
                className="mt-1 w-full rounded-md border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 focus:border-emerald-400 focus:outline-none"
                type="text"
                value={report.cycleSeq}
                onChange={(event) =>
                  setReport((state) => ({ ...state, cycleSeq: event.target.value, error: null }))
                }
                placeholder="optional"
              />
            </label>
            <label className="flex-1 min-w-[160px] text-xs text-zinc-400">
              Category
              <select
                className="mt-1 w-full rounded-md border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 focus:border-emerald-400 focus:outline-none"
                value={report.category}
                onChange={(event) =>
                  setReport((state) => ({ ...state, category: event.target.value, error: null }))
                }
              >
                <option value="issue">Issue</option>
                <option value="sampling">Sampling</option>
                <option value="suggestion">Suggestion</option>
              </select>
            </label>
            <label className="flex-1 min-w-[160px] text-xs text-zinc-400">
              Severity
              <select
                className="mt-1 w-full rounded-md border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 focus:border-emerald-400 focus:outline-none"
                value={report.severity}
                onChange={(event) =>
                  setReport((state) => ({ ...state, severity: event.target.value, error: null }))
                }
              >
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
              </select>
            </label>
          </div>
          <label className="block text-xs text-zinc-400">
            Message
            <textarea
              className="mt-1 w-full rounded-md border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 focus:border-emerald-400 focus:outline-none"
              rows={4}
              value={report.note}
              onChange={(event) =>
                setReport((state) => ({ ...state, note: event.target.value, error: null }))
              }
              placeholder="Tell us what you noticed…"
            />
          </label>
          {report.error && <p className="text-xs text-rose-400">{report.error}</p>}
          {report.success && <p className="text-xs text-emerald-300">{report.success}</p>}
          <div className="flex items-center gap-3">
            <button
              type="submit"
              disabled={report.submitting}
              className="rounded-md border border-emerald-500/50 bg-emerald-500/10 px-4 py-2 text-sm text-emerald-200 hover:border-emerald-400 disabled:opacity-60"
            >
              {report.submitting ? "Sending…" : "Send report"}
            </button>
            <button
              type="button"
              className="text-xs text-zinc-500 hover:text-zinc-300"
              onClick={() => setReport(initialReportState)}
            >
              Clear form
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}

function MetricCard({ label, value, hint }: { label: string; value: number | string; hint?: string | null }) {
  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-950/60 px-4 py-3">
      <p className="text-xs uppercase tracking-wide text-zinc-500">{label}</p>
      <p className="mt-1 text-2xl font-semibold text-zinc-100">{value}</p>
      {hint && <p className="text-[11px] text-zinc-500">{hint}</p>}
    </div>
  );
}

function statusBadge(status: string) {
  if (status === "error") return "bg-rose-900/40 text-rose-200 border border-rose-700/60";
  if (status === "warn") return "bg-amber-900/30 text-amber-200 border border-amber-600/40";
  if (status === "idle") return "bg-zinc-800 text-zinc-200 border border-zinc-700/60";
  return "bg-emerald-900/30 text-emerald-200 border border-emerald-600/40";
}

function formatDate(input?: string | null) {
  if (!input) return "—";
  try {
    return new Date(input).toLocaleString();
  } catch {
    return input;
  }
}
