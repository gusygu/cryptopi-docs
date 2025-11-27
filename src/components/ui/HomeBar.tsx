"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import { useSettings } from "@/lib/settings/client";
import {
  getState,
  requestRefresh,
  setEnabled,
  subscribe,
  type PollerState,
} from "@/lib/pollerClient";
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

type SessionInfo = {
  ok: boolean;
  email: string | null;
  nickname: string | null;
  isAdmin: boolean;
};

type NavLink = { href: string; label: string };

const FEATURE_LINKS: NavLink[] = [
  { href: "/", label: "Home" },
  { href: "/matrices", label: "Matrices" },
  { href: "/dynamics", label: "Dynamics" },
  { href: "/cin", label: "Cin-Aux" },
  { href: "/str-aux", label: "Str-Aux" },
  { href: "/settings", label: "Settings" },
  { href: "/audit", label: "Audit" },
  { href: "/docs", label: "Docs" },
  { href: "/info", label: "Info" },
] as const;

const DEV_LINKS: NavLink[] = [
  { href: "/admin", label: "Admin" },
  { href: "/admin/audit", label: "Audit" },
  { href: "/admin/actions", label: "Actions" },
  { href: "/admin/jobs", label: "Jobs" },
  { href: "/admin/ingest", label: "Ingest" },
  { href: "/admin/invites", label: "Invites" },
  { href: "/admin/users", label: "Users" },
  { href: "/admin/system", label: "System" },
];

const API_ENDPOINTS = [
  { href: "/api/matrices/latest", label: "Matrices: latest" },
  { href: "/api/matrices", label: "Matrices: index" },
  { href: "/api/preview/universe/symbols", label: "Preview universe symbols" },
  { href: "/api/str-aux/stats", label: "STR-aux stats" },
  { href: "/api/str-aux/bins", label: "STR-aux bins" },
  { href: "/api/str-aux/samples", label: "STR-aux samples" },
  { href: "/api/moo-aux", label: "MOO-aux" },
  { href: "/api/settings", label: "Settings" },
  { href: "/api/vitals/health", label: "Vitals health" },
  { href: "/api/vitals/status", label: "Vitals status" },
] as const;

function isRouteActive(pathname: string, href: string) {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

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
  if (level === "ok")
    return "border-emerald-500/40 bg-emerald-600/20 text-emerald-100";
  if (level === "warn")
    return "border-amber-500/40 bg-amber-500/15 text-amber-100";
  if (level === "err")
    return "border-rose-500/40 bg-rose-600/20 text-rose-100";
  if (level === "neutral")
    return "border-sky-500/40 bg-sky-500/15 text-sky-100";
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
  const { data: settings } = useSettings();

  const [autoOn, setAutoOn] = useState(true);
  const [remaining, setRemaining] = useState(40);
  const [duration, setDuration] = useState(40);
  const [phase, setPhase] = useState(1);
  const [cyclesCompleted, setCyclesCompleted] = useState(0);
  const [metMute, setMetMuteState] = useState(true);
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
  const [session, setSession] = useState<SessionInfo | null>(null);

  // Initial poller state sync
  useEffect(() => {
    const state = safeGetPollerState();
    if (!state) return;
    setAutoOn(state.enabled);
    setDuration(state.dur40 ?? 40);
    setRemaining(state.remaining40 ?? state.dur40 ?? 40);
    setPhase(state.phase ?? 1);
    setCyclesCompleted(state.cyclesCompleted ?? 0);
  }, []);

  const durationRef = useRef(duration);
  useEffect(() => {
    durationRef.current = duration;
  }, [duration]);

  const metMuteRef = useRef(metMute);
  useEffect(() => {
    metMuteRef.current = metMute;
  }, [metMute]);

  const audioRef = useRef<AudioContext | null>(null);

  const playClick = useCallback(
    (count: number) => {
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
    },
    []
  );

  // Load current session info from /api/auth/session
  useEffect(() => {
    let cancelled = false;

    async function loadSession() {
      try {
        const res = await fetch("/api/auth/session", { cache: "no-store" });
        if (!res.ok) return;
        const data = (await res.json()) as SessionInfo;
        if (!cancelled) setSession(data);
      } catch {
        // ignore, leave as null
      }
    }

    loadSession();

    return () => {
      cancelled = true;
    };
  }, []);

  // Poller event subscription
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

  // Metronome subscription
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

      const healthJson =
        healthRes && healthRes.ok
          ? await healthRes.json().catch(() => null)
          : null;
      const statusJson =
        statusRes && statusRes.ok
          ? await statusRes.json().catch(() => null)
          : null;

      const healthOk = healthJson
        ? Boolean(healthJson.ok ?? healthJson.db === "up")
        : null;
      const healthDb = healthJson
        ? String(healthJson.db ?? healthJson.status ?? "").toLowerCase() || null
        : null;

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

  // Vitals auto-refresh
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
    const timer =
      typeof window !== "undefined"
        ? window.setInterval(() => loadVitals(), 300_000)
        : null;
    return () => {
      unsub();
      if (timer != null) window.clearInterval(timer);
    };
  }, [loadVitals]);

  // Pulse decay
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
  const progressPct =
    countdownSec != null
      ? Math.min(
          100,
          Math.max(0, ((baseDuration - countdownSec) / baseDuration) * 100)
        )
      : autoOn
      ? 0
      : 100;

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

  const handleLogout = useCallback(async () => {
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } catch {
      // ignore errors, we'll redirect anyway
    }
    window.location.href = "/auth?logout=1";
  }, []);

  const showDevNav = !!session?.isAdmin;

  return (
    <aside
      className={`w-full border-b border-white/10 bg-black/60 text-xs text-zinc-100 backdrop-blur md:border-b-0 md:border-r md:bg-black/70 md:text-sm ${className}`}
      role="complementary"
    >
      <div className="flex h-full flex-col gap-6 overflow-y-auto px-4 py-5 md:px-5 md:py-6">
        <div className="space-y-3">
          <div>
            <Link
              href="/"
              className="text-base font-semibold tracking-tight text-emerald-200"
            >
              CryptoPi Dynamics
            </Link>
            <p className="mt-0.5 text-[11px] text-zinc-500">
              Matrices, aux controls, and vitals.
            </p>
          </div>
          <div className="rounded-xl border border-white/10 bg-zinc-950/60 p-3">
            {session?.email ? (
              <div className="space-y-3">
                <div>
                  <div className="text-sm font-semibold text-zinc-100">
                    {session.nickname || session.email}
                  </div>
                  <p className="text-[11px] text-zinc-500">Signed in</p>
                </div>
                <div className="flex items-center justify-between">
                  {session.isAdmin ? (
                    <span className="rounded-full bg-emerald-600/30 px-2 py-[2px] text-[10px] uppercase tracking-wide text-emerald-100">
                      admin
                    </span>
                  ) : (
                    <span className="text-[10px] uppercase tracking-wide text-zinc-500">
                      member
                    </span>
                  )}
                  <button
                    type="button"
                    onClick={handleLogout}
                    className="rounded-md border border-zinc-700/60 px-3 py-1 text-[11px] text-zinc-200 transition hover:border-rose-500/60 hover:bg-rose-600/20 hover:text-rose-100"
                  >
                    Sign out
                  </button>
                </div>
              </div>
            ) : (
              <div className="space-y-2 text-[11px]">
                <p className="text-zinc-400">Sign in to sync cycles and audit logs.</p>
                <Link
                  href="/auth"
                  className="inline-flex items-center justify-center rounded-md border border-emerald-500/40 px-3 py-1 text-sm text-emerald-200 transition hover:border-emerald-400 hover:text-emerald-100"
                >
                  Sign in
                </Link>
              </div>
            )}
          </div>
        </div>

        <section className="rounded-xl border border-white/10 bg-zinc-950/70 p-4 text-[11px] shadow-[0_10px_30px_rgba(0,0,0,0.35)]">
          <div className="flex items-center justify-between gap-3 text-[11px] uppercase tracking-wide text-zinc-500">
            <span>Metronome</span>
            <span className="font-mono text-sm text-emerald-200">
              {countdownSec != null ? formatCountdown(countdownSec) : "Paused"}
              <span className="ml-1 text-[10px] text-zinc-500">
                / {formatCountdown(settingsCycle)}
              </span>
            </span>
          </div>
          <div className="mt-2 flex items-center gap-2 text-[11px] text-zinc-400">
            <span>Cycle {romanPhase(phase)}</span>
            <span>&middot;</span>
            <span>Loop {loopNumber}</span>
            {pulse ? (
              <span
                className={`ml-auto inline-flex h-3 w-3 items-center justify-center rounded-full transition ${
                  pulse.mode === "double"
                    ? "bg-emerald-400 shadow-[0_0_8px_rgba(16,185,129,0.65)]"
                    : "bg-emerald-500/80"
                }`}
                aria-label={pulse.mode === "double" ? "Loop tick" : "Cycle tick"}
              />
            ) : (
              <span
                className="ml-auto inline-flex h-3 w-3 rounded-full bg-zinc-700/80"
                aria-hidden
              />
            )}
          </div>
          <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-zinc-900/70">
            <div
              className="h-full rounded-full bg-emerald-400 transition-[width]"
              style={{ width: `${progressPct}%` }}
            />
          </div>
          <div className="mt-4 grid grid-cols-2 gap-2 text-[11px]">
            <button
              type="button"
              onClick={() => {
                const next = !autoOn;
                setAutoOn(next);
                setEnabled(next);
              }}
              className={`rounded-md border px-3 py-1 font-medium transition ${
                autoOn
                  ? "border-emerald-500/50 bg-emerald-600/30 text-emerald-50 hover:bg-emerald-600/45"
                  : "border-zinc-600/60 bg-zinc-800/70 text-zinc-200 hover:bg-zinc-700/70"
              }`}
            >
              Auto {autoOn ? "ON" : "OFF"}
            </button>
            <button
              type="button"
              onClick={() => requestRefresh()}
              className="rounded-md border border-sky-500/50 bg-sky-600/30 px-3 py-1 font-medium text-sky-50 transition hover:bg-sky-500/45"
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
              className={`col-span-2 rounded-md border px-3 py-1 font-medium transition ${
                !metMute
                  ? "border-emerald-500/50 bg-emerald-600/30 text-emerald-50 hover:bg-emerald-600/45"
                  : "border-zinc-600/60 bg-zinc-800/70 text-zinc-200 hover:bg-zinc-700/70"
              }`}
            >
              Metronome {metMute ? "OFF" : "ON"}
            </button>
          </div>
        </section>

        <section className="rounded-xl border border-white/10 bg-zinc-950/70 p-4 text-[11px]">
          <div className="flex items-baseline justify-between text-[11px] uppercase tracking-wide text-zinc-500">
            <span>Vitals</span>
            <span className="text-[10px] normal-case text-zinc-400">
              Updated {formatSince(vitals.healthTs ?? vitals.statusTs)}
            </span>
          </div>
          <div className="mt-3 grid gap-2">
            <div
              className={`flex items-center justify-between rounded-lg border px-3 py-2 font-medium ${badgeTone(
                vitals.healthOk == null
                  ? "muted"
                  : vitals.healthOk
                  ? "ok"
                  : "err"
              )}`}
            >
              <span>Health</span>
              <span className="font-mono uppercase">
                {vitals.healthDb ??
                  (vitals.healthOk == null
                    ? "-"
                    : vitals.healthOk
                    ? "up"
                    : "down")}
              </span>
            </div>
            <div
              className={`flex items-center justify-between rounded-lg border px-3 py-2 font-medium ${badgeTone(
                vitals.statusLevel ?? (vitals.loading ? "neutral" : "muted")
              )}`}
            >
              <span>Status</span>
              <span className="font-mono uppercase">
                {vitals.statusLevel
                  ? levelToLabel(vitals.statusLevel)
                  : vitals.loading
                  ? "loading"
                  : "-"}
              </span>
            </div>
          </div>
          <div className="mt-2 text-[10px] text-zinc-400">
            {vitals.statusCounts ? (
              <span>
                ok {vitals.statusCounts.ok} &middot; warn {vitals.statusCounts.warn} &middot; err {vitals.statusCounts.err}
              </span>
            ) : (
              <span>{vitals.loading ? "Fetching." : vitals.error ? "Error" : "-"}</span>
            )}
          </div>
          {vitals.error ? (
            <div className="mt-3 rounded-md border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-[10px] text-rose-100">
              {vitals.error}
            </div>
          ) : null}
        </section>

        <div>
          <p className="text-[11px] uppercase tracking-wide text-zinc-500">Workspace</p>
          <nav className="mt-3 space-y-1" aria-label="Primary">
            {FEATURE_LINKS.map((item) => {
              const active = isRouteActive(pathname, item.href);
              const cls = active
                ? "border-emerald-500/50 bg-emerald-500/15 text-emerald-100 shadow-[0_0_14px_rgba(16,185,129,0.25)]"
                : "border-zinc-800/80 bg-black/30 text-zinc-300 hover:border-emerald-400/40 hover:text-emerald-100";
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  className={`flex items-center justify-between rounded-lg border px-3 py-2 text-sm transition ${cls}`}
                >
                  <span>{item.label}</span>
                  {active ? <span className="text-[10px] uppercase text-emerald-300">now</span> : null}
                </Link>
              );
            })}
          </nav>
        </div>

        {showDevNav ? (
          <div>
            <p className="text-[11px] uppercase tracking-wide text-zinc-500">Admin tools</p>
            <nav className="mt-3 space-y-1" aria-label="Developer">
              {DEV_LINKS.map((item) => {
                const active = isRouteActive(pathname, item.href);
                const cls = active
                  ? "border-sky-500/60 bg-sky-600/20 text-sky-100 shadow-[0_0_14px_rgba(56,189,248,0.25)]"
                  : "border-zinc-800/80 bg-black/30 text-zinc-300 hover:border-sky-500/40 hover:text-sky-100";
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    aria-current={active ? "page" : undefined}
                    className={`flex items-center justify-between rounded-lg border px-3 py-2 text-sm transition ${cls}`}
                  >
                    <span>{item.label}</span>
                    {active ? <span className="text-[10px] uppercase text-sky-200">now</span> : null}
                  </Link>
                );
              })}
            </nav>
          </div>
        ) : null}

        <div className="mt-auto space-y-2 border-t border-white/5 pt-4">
          <label
            className="text-[11px] uppercase tracking-wide text-zinc-500"
            htmlFor="homebar-api-select"
          >
            API quick links
          </label>
          <select
            id="homebar-api-select"
            className="w-full rounded-md border border-zinc-700/60 bg-zinc-900/80 px-3 py-2 text-[11px] text-zinc-200 focus:border-emerald-500/60 focus:outline-none focus:ring-0"
            value={apiSelection}
            onChange={(event) => {
              const value = event.target.value;
              setApiSelection("");
              if (value) handleApiRedirect(value);
            }}
          >
            <option value="">Select endpoint</option>
            {API_ENDPOINTS.map((api) => (
              <option key={api.href} value={api.href}>
                {api.label}
              </option>
            ))}
          </select>
        </div>
      </div>
    </aside>

  );
}
