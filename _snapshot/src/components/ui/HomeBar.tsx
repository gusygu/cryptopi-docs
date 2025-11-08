"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useSettings } from "@/lib/settings/client";
import { getState, requestRefresh, setEnabled, subscribe, type PollerState } from "@/lib/pollerClient";
import { getMuted, setMuted, subscribeMet } from "@/lib/metronome";
import type { ReportLevel } from "@/lib/types";

type TickPulse = { ts: number; mode: "single" | "double" };

type VitalsState = {
  loading: boolean;
  error: string | null;
  healthOk: boolean | null;
  healthDb: string | null;
  healthTs?: number;
  statusLevel: ReportLevel | null;
  statusCounts: { ok: number; warn: number; err: number; total: number } | null;
  statusTs?: number;
};

const NAV_ITEMS = [
  { href: "/", label: "Home" },
  { href: "/matrices", label: "Matrices" },
  { href: "/dynamics", label: "Dynamics" },
  { href: "/str-aux", label: "Str-Aux" },
  { href: "/settings", label: "Settings" },
  { href: "/info", label: "Info" },
] as const;

const API_ENDPOINTS = [
  { href: "/api/matrices/latest", label: "Matrices: latest" },
  { href: "/api/matrices", label: "Matrices: index" },
  { href: "/api/preview/universe/symbols", label: "Preview universe symbols" },
  { href: "/api/str-aux/stats", label: "STR-aux stats" },
  { href: "/api/str-aux/bins", label: "STR-aux bins" },
  { href: "/api/str-aux/samples", label: "STR-aux samples" },
  { href: "/api/mea-aux", label: "MEA-aux" },
  { href: "/api/settings", label: "Settings" },
  { href: "/api/vitals/health", label: "Vitals health" },
  { href: "/api/vitals/status", label: "Vitals status" },
] as const;

function safeGetPollerState(): PollerState | null {
  if (typeof window === "undefined") return null;
  try {
    return getState();
  } catch {
    return null;
  }
}

function safeGetMuted(): boolean {
  if (typeof window === "undefined") return true;
  try {
    return getMuted();
  } catch {
    return true;
  }
}

function formatCountdown(seconds: number) {
  const s = Math.max(0, Math.floor(seconds));
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return `${m}:${rem.toString().padStart(2, "0")}`;
}

function formatSince(ts?: number) {
  if (!ts) return "—";
  const delta = Date.now() - ts;
  if (delta < 0) return "now";
  if (delta < 10_000) return "just now";
  if (delta < 60_000) return `${Math.round(delta / 1_000)}s ago`;
  if (delta < 3_600_000) return `${Math.round(delta / 60_000)}m ago`;
  return `${Math.round(delta / 3_600_000)}h ago`;
}

function badgeTone(level: "ok" | "warn" | "err" | "neutral" | "muted") {
  if (level === "ok") return "border-emerald-500/40 bg-emerald-600/20 text-emerald-100";
  if (level === "warn") return "border-amber-500/40 bg-amber-500/15 text-amber-100";
  if (level === "err") return "border-rose-500/40 bg-rose-600/20 text-rose-100";
  if (level === "neutral") return "border-sky-500/40 bg-sky-500/15 text-sky-100";
  return "border-zinc-600/40 bg-zinc-800/60 text-zinc-200";
}

function levelToLabel(level: ReportLevel | null) {
  if (!level) return "unknown";
  if (level === "ok") return "all green";
  if (level === "warn") return "warnings";
  return "attention";
}

function romanPhase(phase: number) {
  const map = ["I", "II", "III"];
  const idx = ((phase - 1) % map.length + map.length) % map.length;
  return map[idx] ?? "I";
}

export default function HomeBar({ className = "" }: { className?: string }) {
  const pathname = usePathname() || "/";
  const initialPoller = useMemo(() => safeGetPollerState(), []);
  const initialMuted = useMemo(() => safeGetMuted(), []);

  const { data: settings } = useSettings();

  const [autoOn, setAutoOn] = useState(initialPoller?.enabled ?? true);
  const [remaining, setRemaining] = useState(initialPoller?.remaining40 ?? initialPoller?.dur40 ?? 40);
  const [duration, setDuration] = useState(initialPoller?.dur40 ?? 40);
  const [phase, setPhase] = useState(initialPoller?.phase ?? 1);
  const [cyclesCompleted, setCyclesCompleted] = useState(initialPoller?.cyclesCompleted ?? 0);
  const [metMute, setMetMuteState] = useState(initialMuted);
  const [pulse, setPulse] = useState<TickPulse | null>(null);
  const [apiSelection, setApiSelection] = useState("");
  const [vitals, setVitals] = useState<VitalsState>({
    loading: true,
    error: null,
    healthOk: null,
    healthDb: null,
    statusLevel: null,
    statusCounts: null,
  });

  const durationRef = useRef(duration);
  useEffect(() => {
    durationRef.current = duration;
  }, [duration]);

  const metMuteRef = useRef(metMute);
  useEffect(() => {
    metMuteRef.current = metMute;
  }, [metMute]);

  const audioRef = useRef<AudioContext | null>(null);

  const playClick = useCallback((count: number) => {
    if (typeof window === "undefined" || metMuteRef.current) return;
    let ctx = audioRef.current;
    if (!ctx) {
      try {
        ctx = new AudioContext({ latencyHint: "interactive" });
        audioRef.current = ctx;
      } catch {
        return;
      }
    }
    if (ctx.state === "suspended") {
      void ctx.resume().catch(() => {});
    }
    const start = ctx.currentTime;
    for (let i = 0; i < count; i++) {
      const tickStart = start + i * 0.24;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "triangle";
      osc.frequency.setValueAtTime(i === 0 ? 1320 : 880, tickStart);
      gain.gain.setValueAtTime(0.0001, tickStart);
      gain.gain.exponentialRampToValueAtTime(0.4, tickStart + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.0001, tickStart + 0.18);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(tickStart);
      osc.stop(tickStart + 0.2);
    }
  }, []);

  useEffect(() => {
    const unsub = subscribe((ev) => {
      if (ev.type === "state") {
        setAutoOn(ev.state.enabled);
        setDuration(ev.state.dur40);
        setRemaining(ev.state.remaining40);
        setPhase(ev.state.phase);
        setCyclesCompleted(ev.state.cyclesCompleted);
      } else if (ev.type === "tick") {
        setRemaining(ev.remaining40);
        setPhase(ev.phase);
      } else if (ev.type === "tick40") {
        setPulse({ ts: Date.now(), mode: ev.isThird ? "double" : "single" });
        playClick(ev.isThird ? 2 : 1);
      } else if (ev.type === "refresh") {
        setRemaining(durationRef.current);
        setPulse({ ts: Date.now(), mode: "double" });
        playClick(2);
      }
    });
    return () => {
      unsub();
    };
  }, [playClick]);

  useEffect(() => {
    const unsub = subscribeMet((ev) => {
      if (ev.type === "metronome") setMetMuteState(ev.muted);
    });
    setMetMuteState(safeGetMuted());
    return () => {
      unsub();
    };
  }, []);

  const loadVitals = useCallback(async () => {
    setVitals((prev) => ({ ...prev, loading: true, error: null }));
    try {
      const [healthRes, statusRes] = await Promise.all([
        fetch("/api/vitals/health", { cache: "no-store" }).catch(() => null),
        fetch("/api/vitals/status", { cache: "no-store" }).catch(() => null),
      ]);

      const healthJson = healthRes && healthRes.ok ? await healthRes.json().catch(() => null) : null;
      const statusJson = statusRes && statusRes.ok ? await statusRes.json().catch(() => null) : null;

      const healthOk = healthJson ? Boolean(healthJson.ok ?? (healthJson.db === "up")) : null;
      const healthDb = healthJson ? String(healthJson.db ?? healthJson.status ?? "").toLowerCase() || null : null;

      let statusLevel: ReportLevel | null = null;
      let statusCounts: VitalsState["statusCounts"] = null;
      if (statusJson && typeof statusJson === "object") {
        const summary = statusJson.summary;
        const level = typeof summary?.level === "string" ? summary.level : null;
        if (level === "ok" || level === "warn" || level === "err") {
          statusLevel = level;
        }
        const counts = summary?.counts;
        if (counts && typeof counts === "object") {
          statusCounts = {
            ok: Number(counts.ok ?? 0),
            warn: Number(counts.warn ?? 0),
            err: Number(counts.err ?? 0),
            total: Number(counts.total ?? 0),
          };
        }
      }

      setVitals({
        loading: false,
        error: null,
        healthOk,
        healthDb,
        healthTs: healthJson?.ts ? Number(healthJson.ts) : Date.now(),
        statusLevel,
        statusCounts,
        statusTs: statusJson?.ts ? Number(statusJson.ts) : Date.now(),
      });
    } catch (err) {
      setVitals({
        loading: false,
        error: err instanceof Error ? err.message : String(err),
        healthOk: null,
        healthDb: null,
        statusLevel: null,
        statusCounts: null,
      });
    }
  }, []);

  useEffect(() => {
    loadVitals();
    const unsub = subscribe((ev) => {
      if (ev.type === "tick120") {
        loadVitals();
      } else if (ev.type === "tick40" && ev.isThird) {
        loadVitals();
      } else if (ev.type === "refresh") {
        loadVitals();
      }
    });
    const timer = typeof window !== "undefined"
      ? window.setInterval(() => loadVitals(), 300_000)
      : null;
    return () => {
      unsub();
      if (timer != null) window.clearInterval(timer);
    };
  }, [loadVitals]);

  useEffect(() => {
    if (!pulse) return;
    const timer = window.setTimeout(() => setPulse(null), 420);
    return () => window.clearTimeout(timer);
  }, [pulse]);

  const countdownSec = autoOn ? Math.max(0, Math.round(remaining)) : null;
  const baseDuration = Math.max(1, Math.round(duration));
  const settingsCycle = Math.max(
    1,
    Math.round(
      (settings?.timing?.autoRefreshMs ?? baseDuration * 1000) / 1000
    )
  );
  const progressPct = countdownSec != null
    ? Math.min(100, Math.max(0, ((baseDuration - countdownSec) / baseDuration) * 100))
    : autoOn ? 0 : 100;

  const loopNumber = Math.floor(cyclesCompleted / 3) + 1;

  const handleApiRedirect = useCallback((href: string) => {
    if (!href) return;
    try {
      const target = href.startsWith("http") ? href : href;
      window.open(target, "_blank", "noopener,noreferrer");
    } catch {
      window.location.href = href;
    }
  }, []);

  return (
    <div
      className={`sticky top-0 z-40 border-b border-white/10 bg-black/60 backdrop-blur ${className}`}
      role="banner"
    >
      <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center gap-3 px-4 py-3 text-xs text-zinc-100 sm:text-sm">
        {/* Brand + navigation */}
        <div className="flex flex-1 flex-wrap items-center gap-2">
          <Link href="/" className="text-sm font-semibold tracking-tight text-emerald-200">
            CryptoPi Dynamics
          </Link>
          <nav className="flex flex-wrap items-center gap-1" aria-label="Primary">
            {NAV_ITEMS.map((item) => {
              const active =
                pathname === item.href ||
                (item.href !== "/" && pathname.startsWith(`${item.href}/`));
              const cls = active
                ? "border-emerald-500/50 bg-emerald-500/15 text-emerald-100"
                : "border-zinc-700/50 bg-zinc-900/70 text-zinc-200 hover:border-emerald-400/40 hover:text-emerald-100";
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  className={`rounded-md border px-2.5 py-1 transition ${cls}`}
                >
                  {item.label}
                </Link>
              );
            })}
          </nav>
          <div className="relative">
            <label className="sr-only" htmlFor="homebar-api-select">
              API quick navigation
            </label>
            <select
              id="homebar-api-select"
              className="rounded-md border border-zinc-700/60 bg-zinc-900/80 px-2 py-1 text-[11px] text-zinc-200 focus:border-emerald-500/60 focus:outline-none focus:ring-0 sm:text-xs"
              value={apiSelection}
              onChange={(event) => {
                const value = event.target.value;
                setApiSelection("");
                if (value) handleApiRedirect(value);
              }}
            >
              <option value="">API endpoints…</option>
              {API_ENDPOINTS.map((api) => (
                <option key={api.href} value={api.href}>
                  {api.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Poller controls */}
        <div className="flex flex-none items-center gap-2 rounded-lg border border-white/10 bg-zinc-950/70 px-3 py-2">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => {
                const next = !autoOn;
                setAutoOn(next);
                setEnabled(next);
              }}
              className={`rounded-md border px-2 py-1 text-[11px] font-medium transition sm:text-xs ${
                autoOn
                  ? "border-emerald-500/50 bg-emerald-600/30 text-emerald-50 hover:bg-emerald-600/45"
                  : "border-zinc-600/60 bg-zinc-800/70 text-zinc-200 hover:bg-zinc-700/70"
              }`}
            >
              Auto&nbsp;{autoOn ? "ON" : "OFF"}
            </button>
            <button
              type="button"
              onClick={() => requestRefresh()}
              className="rounded-md border border-sky-500/50 bg-sky-600/30 px-2 py-1 text-[11px] text-sky-50 transition hover:bg-sky-500/45 sm:text-xs"
            >
              Refresh
            </button>
            <button
              type="button"
              onClick={() => {
                const next = !metMute;
                setMetMuteState(next);
                setMuted(next);
              }}
              className={`rounded-md border px-2 py-1 text-[11px] transition sm:text-xs ${
                !metMute
                  ? "border-emerald-500/50 bg-emerald-600/30 text-emerald-50 hover:bg-emerald-600/45"
                  : "border-zinc-600/60 bg-zinc-800/70 text-zinc-200 hover:bg-zinc-700/70"
              }`}
            >
              Metronome&nbsp;{metMute ? "OFF" : "ON"}
            </button>
          </div>
          <div className="hidden h-8 w-px bg-zinc-700/60 sm:block" aria-hidden />
          <div className="flex flex-col text-[11px] leading-tight sm:text-xs">
            <div className="flex items-center gap-1 font-mono uppercase tracking-wide text-emerald-200/80">
              <span>{countdownSec != null ? formatCountdown(countdownSec) : "Paused"}</span>
              <span className="text-[10px] text-zinc-400">
                / {formatCountdown(settingsCycle)}
              </span>
            </div>
            <div className="flex items-center gap-1 text-[10px] text-zinc-400">
              <span>Cycle {romanPhase(phase)}</span>
              <span>&middot;</span>
              <span>Loop {loopNumber}</span>
              {pulse ? (
                <span
                  className={`inline-flex h-2.5 w-2.5 items-center justify-center rounded-full transition ${
                    pulse.mode === "double"
                      ? "bg-emerald-400 shadow-[0_0_6px_1px_rgba(16,185,129,0.55)]"
                      : "bg-emerald-500/80"
                  }`}
                  aria-label={pulse.mode === "double" ? "Loop tick" : "Cycle tick"}
                />
              ) : (
                <span className="inline-flex h-2.5 w-2.5 rounded-full bg-zinc-700/80" aria-hidden />
              )}
            </div>
            <div className="mt-1 h-1 w-full overflow-hidden rounded-full bg-zinc-800/80">
              <div
                className="h-full bg-emerald-400 transition-[width]"
                style={{ width: `${progressPct}%` }}
              />
            </div>
          </div>
        </div>

        {/* Status / vitals */}
        <div className="flex min-w-[220px] flex-none flex-col gap-1 rounded-lg border border-white/10 bg-zinc-950/70 px-3 py-2 text-[11px] sm:text-xs">
          <div className="flex items-center justify-between gap-2">
            <span className={`inline-flex items-center gap-1 rounded-md border px-2 py-[2px] font-medium ${badgeTone(
              vitals.healthOk == null ? "muted" : vitals.healthOk ? "ok" : "err"
            )}`}>
              <span>Health</span>
              <span className="font-mono uppercase">
                {vitals.healthDb ?? (vitals.healthOk == null ? "—" : vitals.healthOk ? "up" : "down")}
              </span>
            </span>
            <span className={`inline-flex items-center gap-1 rounded-md border px-2 py-[2px] font-medium ${badgeTone(
              vitals.statusLevel ?? (vitals.loading ? "neutral" : "muted")
            )}`}>
              <span>Status</span>
              <span className="font-mono uppercase">
                {vitals.statusLevel ? levelToLabel(vitals.statusLevel) : vitals.loading ? "loading" : "—"}
              </span>
            </span>
          </div>
          <div className="flex items-center justify-between text-[10px] text-zinc-400 sm:text-[11px]">
            <span>
              Updated {formatSince(vitals.healthTs ?? vitals.statusTs)}
            </span>
            {vitals.statusCounts ? (
              <span>
                ok {vitals.statusCounts.ok} · warn {vitals.statusCounts.warn} · err {vitals.statusCounts.err}
              </span>
            ) : (
              <span>{vitals.loading ? "Fetching…" : vitals.error ? "Error" : "—"}</span>
            )}
          </div>
          {vitals.error ? (
            <div className="rounded-md border border-rose-500/30 bg-rose-500/10 px-2 py-1 text-[10px] text-rose-100">
              {vitals.error}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
