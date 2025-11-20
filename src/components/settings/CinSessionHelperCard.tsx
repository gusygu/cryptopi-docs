"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

type CinSessionIdType = "uuid" | "bigint";

type CinSessionSummary = {
  sessionId: string;
  windowLabel: string | null;
  startedAt: string | null;
  endedAt: string | null;
  closed: boolean;
  openingPrincipalUsdt: string | null;
  openingProfitUsdt: string | null;
  closingPrincipalUsdt: string | null;
  closingProfitUsdt: string | null;
};

type ListResponse =
  | { ok: true; idType: CinSessionIdType; sessions: CinSessionSummary[] }
  | { ok: false; error: string };

const numberFormatter = new Intl.NumberFormat("en-US", {
  notation: "compact",
  maximumFractionDigits: 2,
});

const formatUsd = (value: string | number | null | undefined) => {
  if (value === null || value === undefined) return "—";
  const num = Number(value);
  if (!Number.isFinite(num)) return String(value);
  return numberFormatter.format(num);
};

const formatDate = (iso: string | null) => {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
};

export default function CinSessionHelperCard() {
  const [sessions, setSessions] = useState<CinSessionSummary[]>([]);
  const [idType, setIdType] = useState<CinSessionIdType | null>(null);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const loadSessions = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/cin-aux/session/list");
      const data: ListResponse = await res.json();
      if (!res.ok) {
        const message = data.ok ? "Failed to fetch sessions" : data.error;
        throw new Error(message);
      }
      if (!data.ok) {
        throw new Error(data.error);
      }
      setSessions(data.sessions);
      setIdType(data.idType);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Failed to fetch sessions";
      setError(message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadSessions();
  }, [loadSessions]);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 3500);
    return () => clearTimeout(timer);
  }, [toast]);

  const openSession = async () => {
    setCreating(true);
    setError(null);
    try {
      const res = await fetch("/api/cin-aux/session/open", { method: "POST" });
      const data: { sessionId?: string | number; error?: string } = await res.json();
      if (!res.ok) {
        throw new Error(data?.error || "Unable to open session");
      }
      setToast(`Session ${data.sessionId} minted.`);
      await loadSessions();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Unable to open session";
      setError(message);
    } finally {
      setCreating(false);
    }
  };

  const copySession = async (sessionId: string) => {
    try {
      if (navigator?.clipboard?.writeText) {
        await navigator.clipboard.writeText(sessionId);
        setToast("Session id copied.");
        return;
      }
    } catch {
      // fall through to manual prompt
    }
    window?.prompt?.("Session id", sessionId);
  };

  const openMatrices = (sessionId: string) => {
    if (typeof window === "undefined") return;
    const url = `/matrices?sessionId=${encodeURIComponent(sessionId)}`;
    window.open(url, "_blank", "noopener");
  };

  const stateLabel = useMemo(() => {
    if (loading) return "Loading sessions…";
    if (creating) return "Creating session…";
    return null;
  }, [loading, creating]);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2 text-[11px] uppercase tracking-[0.24em] text-slate-400">
        <span className="font-semibold text-white/80">CIN-AUX session ids</span>
        <span className="text-slate-500">type:</span>
        <code className="rounded bg-white/10 px-2 py-0.5 text-[10px] font-mono text-emerald-200">
          {idType ?? "…"}
        </code>
        {stateLabel ? <span className="text-emerald-300">{stateLabel}</span> : null}
      </div>

      <div className="flex flex-wrap gap-2 text-xs">
        <button
          type="button"
          className="rounded-full border border-white/20 px-3 py-1 text-white/90 transition hover:border-white/40 disabled:opacity-40"
          onClick={loadSessions}
          disabled={loading || creating}
        >
          Refresh
        </button>
        <button
          type="button"
          className="rounded-full bg-emerald-500/80 px-3 py-1 text-emerald-950 transition hover:bg-emerald-400 disabled:opacity-50"
          onClick={openSession}
          disabled={creating}
        >
          {creating ? "Minting…" : "Open new session"}
        </button>
      </div>

      {error ? (
        <div className="rounded-md border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-200">
          {error}
        </div>
      ) : null}

      {toast ? (
        <div className="rounded-md border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-200">
          {toast}
        </div>
      ) : null}

      <div className="space-y-2">
        {sessions.length === 0 && !loading ? (
          <div className="rounded-lg border border-dashed border-white/10 bg-white/[0.03] p-4 text-sm text-slate-400">
            No sessions found yet. Use “Open new session” to mint one.
          </div>
        ) : null}

        {sessions.map((s) => (
          <article
            key={s.sessionId}
            className="rounded-lg border border-white/10 bg-white/[0.03] p-3 text-sm"
          >
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="text-[11px] uppercase tracking-[0.18em] text-slate-400">session id</div>
                <div className="font-mono text-xs text-white/90 break-all">{s.sessionId}</div>
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  className="rounded border border-white/20 px-2 py-1 text-[11px] uppercase tracking-[0.2em] text-white/80 hover:border-white/40"
                  onClick={() => copySession(s.sessionId)}
                >
                  Copy
                </button>
                <button
                  type="button"
                  className="rounded border border-emerald-500/40 px-2 py-1 text-[11px] uppercase tracking-[0.2em] text-emerald-300 hover:border-emerald-400"
                  onClick={() => openMatrices(s.sessionId)}
                >
                  Use on matrices
                </button>
              </div>
            </div>
            <dl className="mt-3 grid gap-2 text-xs text-slate-300 sm:grid-cols-2">
              <div>
                <span className="text-slate-500">Window </span>
                {s.windowLabel || "—"}
                <span className="text-slate-500"> · started </span>
                {formatDate(s.startedAt)}
              </div>
              <div>
                <span className="text-slate-500">Closed? </span>
                {s.closed ? "yes" : "no"}
                {s.endedAt ? (
                  <>
                    <span className="text-slate-500"> · ended </span>
                    {formatDate(s.endedAt)}
                  </>
                ) : null}
              </div>
              <div>
                <span className="text-slate-500">Opening principal </span>
                {formatUsd(s.openingPrincipalUsdt)}
                <span className="text-slate-500"> · profit </span>
                {formatUsd(s.openingProfitUsdt)}
              </div>
              <div>
                <span className="text-slate-500">Closing principal </span>
                {formatUsd(s.closingPrincipalUsdt)}
                <span className="text-slate-500"> · profit </span>
                {formatUsd(s.closingProfitUsdt)}
              </div>
            </dl>
          </article>
        ))}
      </div>
    </div>
  );
}
