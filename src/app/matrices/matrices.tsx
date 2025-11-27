"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Matrices, { type ApiMatrixRow, withAlpha } from "@/components/features/matrices/Matrices";
import { colorForChange, type FrozenStage } from "@/components/features/matrices/colors";
import { useSettings } from "@/lib/settings/client";

type MatrixValues = Record<string, Record<string, number | null>>;

type MatrixFlags = {
  frozen?: boolean[][];
  frozenSymbols?: Record<string, boolean>;
};

type MatrixSlice = {
  ts?: number;
  values?: MatrixValues;
  flags?: MatrixFlags;
};

type MatricesLatestResponse = {
  ok?: boolean;
  error?: string;
  coins?: string[];
  symbols?: string[];
  quote?: string;
  matrices?: {
    benchmark?: MatrixSlice;
    pct24h?: { values?: MatrixValues };
    id_pct?: { values?: MatrixValues };
    pct_drv?: { values?: MatrixValues };
    pct_ref?: { values?: MatrixValues };
    ref?: { values?: MatrixValues };
    delta?: { values?: MatrixValues };
  };
};

const DEFAULT_POLL_INTERVAL_MS = 40_000;
const FROZEN_EPSILON = 1e-8;
const STREAK_MID_THRESHOLD = 3;
const STREAK_LONG_THRESHOLD = 6;

const pairKey = (base: string, quote: string) => `${base}|${quote}`;

const streakToStage = (streak: number): FrozenStage | null => {
  if (!Number.isFinite(streak) || streak <= 0) return null;
  if (streak > STREAK_LONG_THRESHOLD) return "long";
  if (streak >= STREAK_MID_THRESHOLD) return "mid";
  return "recent";
};

const normalizeKey = (value: string) => String(value ?? "").toUpperCase();

const isSymbolFrozen = (
  flags: Record<string, boolean>,
  base: string,
  quote: string
): boolean => {
  const baseKey = normalizeKey(base);
  const quoteKey = normalizeKey(quote);
  return (
    Boolean(flags[baseKey]) ||
    Boolean(flags[`${baseKey}${quoteKey}`]) ||
    Boolean(flags[`${baseKey}/${quoteKey}`])
  );
};

const toUpper = (token: string | null | undefined) => String(token ?? "").trim().toUpperCase();

const getMatrixValue = (matrix: MatrixValues | undefined, base: string, quote: string): number | null => {
  const raw = matrix?.[base]?.[quote];
  if (raw == null) return null;
  const num = Number(raw);
  return Number.isFinite(num) ? num : null;
};

type BuildRowsArgs = {
  payload: MatricesLatestResponse | null;
  previewSet: Set<string>;
  frozenStreaks: Map<string, number>;
};

function buildMatrixRows({ payload, previewSet, frozenStreaks }: BuildRowsArgs): ApiMatrixRow[] {
  if (!payload?.ok) return [];

  const quote = toUpper(payload.quote ?? "USDT");
  const coinsRaw = Array.isArray(payload.coins) ? payload.coins.map(toUpper) : [];
  const coins = coinsRaw.filter((c) => c && c !== quote);
  const fullCoins = [quote, ...coins];

  const symbolsSet = new Set((payload.symbols ?? []).map(toUpper));
  const benchmarkSlice = payload.matrices?.benchmark;
  const flags = (benchmarkSlice?.flags ?? {}) as MatrixFlags;
  const frozenGrid = Array.isArray(flags?.frozen) ? flags.frozen : undefined;
  const frozenSymbolsRaw = flags?.frozenSymbols ?? {};
  const symbolFlags: Record<string, boolean> = {};
  for (const [key, value] of Object.entries(frozenSymbolsRaw)) {
    symbolFlags[normalizeKey(key)] = Boolean(value);
  }

  const pct24Values = payload.matrices?.pct24h?.values ?? {};
  const idValues = payload.matrices?.id_pct?.values ?? {};
  const drvValues = payload.matrices?.pct_drv?.values ?? {};
  const pctRefValues = payload.matrices?.pct_ref?.values ?? {};
  const refValues = payload.matrices?.ref?.values ?? {};
  const deltaValues = payload.matrices?.delta?.values ?? {};
  const benchValues = benchmarkSlice?.values ?? {};

  return coins.map((base) => {
    const baseIdx = fullCoins.indexOf(base);
    const quoteIdx = fullCoins.indexOf(quote);
    const frozenCell = baseIdx >= 0 && quoteIdx >= 0 && frozenGrid?.[baseIdx]?.[quoteIdx] === true;
    const symbolFrozen = isSymbolFrozen(symbolFlags, base, quote);
    const streak = frozenStreaks.get(pairKey(base, quote)) ?? 0;
    let effectiveStage: FrozenStage | null = symbolFrozen ? "long" : streakToStage(streak);
    if (!effectiveStage && frozenCell) {
      effectiveStage = "mid";
    }
    const frozen = Boolean(effectiveStage);

    const directSymbol = `${base}${quote}`;
    const inverseSymbol = `${quote}${base}`;
    const derivation = symbolsSet.has(directSymbol)
      ? "direct"
      : symbolsSet.has(inverseSymbol)
      ? "inverse"
      : "bridged";

    const pairRing = frozen
      ? "purple"
      : derivation === "direct"
      ? "green"
      : derivation === "inverse"
      ? "red"
      : "grey";

    const directPreview = previewSet.has(directSymbol);
    const inversePreview = previewSet.has(inverseSymbol);
    const symbolRing = frozen
      ? "purple"
      : directPreview
      ? "green"
      : inversePreview
      ? "red"
      : "grey";

    const benchmarkValue = getMatrixValue(benchValues, base, quote);
    const pct24 = getMatrixValue(pct24Values, base, quote);
    const idPct = getMatrixValue(idValues, base, quote);
    const pctDrv = getMatrixValue(drvValues, base, quote);
    const pctRef = getMatrixValue(pctRefValues, base, quote);
    const refVal = getMatrixValue(refValues, base, quote);
    const deltaVal = getMatrixValue(deltaValues, base, quote);

    const benchmarkColor = colorForChange(benchmarkValue, { frozenStage: effectiveStage });
    const pctColor = colorForChange(pct24, { frozenStage: effectiveStage });
    const idColor = colorForChange(idPct, { frozenStage: effectiveStage });
    const drvColor = colorForChange(pctDrv, { frozenStage: effectiveStage });
    const refColor = colorForChange(pctRef, { frozenStage: effectiveStage });
    const refValColor = colorForChange(refVal, { frozenStage: effectiveStage });
    const deltaColor = colorForChange(deltaVal, { frozenStage: effectiveStage, zeroFloor: 0.0001 });

    return {
      pair: `${base}/${quote}`,
      base,
      quote,
      derivation,
      ring: pairRing,
      symbolRing,
      symbolFrozen: frozen,
      benchmark_pct24h: {
        top: { value: benchmarkValue, color: benchmarkColor, derivation, ring: pairRing },
        bottom: { value: pct24, color: pctColor, derivation, ring: pairRing },
      },
      ref_block: {
        top: { value: pctRef, color: refColor, derivation, ring: pairRing },
        bottom: { value: refVal, color: refValColor, derivation, ring: pairRing },
      },
      delta: { value: deltaVal, color: deltaColor, derivation, ring: pairRing },
      id_pct: { value: idPct, color: idColor, derivation, ring: pairRing },
      pct_drv: { value: pctDrv, color: drvColor, derivation, ring: pairRing },
      meta: { frozen, frozenStage: effectiveStage },
    };
  });
}

const RING_LEGEND = [
  { label: "direct leg active", color: "#4ade80" },
  { label: "inverse leg only", color: "#f87171" },
  { label: "bridged route", color: "#94a3b8" },
  { label: "frozen", color: "#c084fc" },
  { label: "near-flat delta", color: "#facc15", square: true },
];

function formatTimestamp(ts?: number | null): string {
  if (!ts && ts !== 0) return "-";
  const date = new Date(Number(ts));
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleString(undefined, { hour12: false });
}

type MoodSnapshot = {
  score: number | null;
  amplitude: number | null;
  label: string;
  accent: string;
  description: string;
  buckets: { positive: number; negative: number; neutral: number; total: number };
  dominance: number | null;
};

const ZERO_FLOOR = 0.0005;

const MOOD_LEVELS: Array<{ max: number; label: string; accent: string; description: string }> = [
  { max: -0.03, label: "PANIC", accent: "#ef4444", description: "Liquidity flight and forced repricing." },
  { max: -0.01, label: "BEAR", accent: "#f97316", description: "Downside pressure dominating the grid." },
  { max: 0.01, label: "NEUTRAL", accent: "#38bdf8", description: "Bid/ask tension in balance." },
  { max: 0.03, label: "BULL", accent: "#4ade80", description: "Accumulation bias with constructive drift." },
  { max: Number.POSITIVE_INFINITY, label: "EUPHORIA", accent: "#a855f7", description: "Momentum regime with elevated risk appetite." },
];

const EMPTY_MOOD: MoodSnapshot = {
  score: null,
  amplitude: null,
  label: "NO SIGNAL",
  accent: "#64748b",
  description: "Awaiting stable id_pct readings from matrices.",
  buckets: { positive: 0, negative: 0, neutral: 0, total: 0 },
  dominance: null,
};

function computeMood(rows: ApiMatrixRow[]): MoodSnapshot {
  const values = rows
    .map((row) => row.id_pct.value)
    .filter((value): value is number => value != null && Number.isFinite(value));

  if (!values.length) return EMPTY_MOOD;

  const sum = values.reduce((acc, value) => acc + value, 0);
  const avg = sum / values.length;

  let positive = 0;
  let negative = 0;
  let neutral = 0;
  let max = -Infinity;
  let min = Infinity;

  for (const v of values) {
    if (v > max) max = v;
    if (v < min) min = v;

    if (Math.abs(v) < ZERO_FLOOR) {
      neutral += 1;
    } else if (v > 0) {
      positive += 1;
    } else {
      negative += 1;
    }
  }

  const amplitude = max - min;
  const buckets = { positive, negative, neutral, total: values.length };
  const dominance = values.length ? (positive - negative) / values.length : null;
  const level = MOOD_LEVELS.find((entry) => avg <= entry.max) ?? MOOD_LEVELS[MOOD_LEVELS.length - 1];

  return {
    score: avg,
    amplitude,
    label: level.label,
    accent: level.accent,
    description: level.description,
    buckets,
    dominance,
  };
}

type MoodEntry = {
  pair: string;
  value: number;
  color: string;
  derivation: ApiMatrixRow["derivation"];
};

function selectTop(rows: ApiMatrixRow[], direction: "winners" | "losers", take = 3): MoodEntry[] {
  const numeric = rows
    .map((row) => ({
      pair: row.pair,
      value: row.id_pct.value,
      color: row.id_pct.color,
      derivation: row.derivation,
    }))
    .filter((entry): entry is MoodEntry => entry.value != null && Number.isFinite(entry.value));

  if (!numeric.length) return [];

  const byDirection =
    direction === "winners"
      ? numeric.filter((entry) => entry.value > ZERO_FLOOR)
      : numeric.filter((entry) => entry.value < -ZERO_FLOOR);

  const pool = byDirection.length ? byDirection : numeric;
  const sorted = [...pool].sort((a, b) =>
    direction === "winners" ? b.value - a.value : a.value - b.value
  );

  return sorted.slice(0, take);
}

const DERIVATION_BADGE: Record<ApiMatrixRow["derivation"], string> = {
  direct: "bg-emerald-500/20 text-emerald-200",
  inverse: "bg-rose-500/20 text-rose-200",
  bridged: "bg-slate-500/20 text-slate-200",
};

function textColorForValue(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return "#e2e8f0";
  return value >= 0 ? "#022c22" : "#fef2f2";
}

function formatPercent(value: number | null, digits = 2): string {
  if (value == null || !Number.isFinite(value)) return "-";
  return `${(value * 100).toFixed(digits)}%`;
}

type MoodAuxPanelProps = {
  snapshot: MoodSnapshot;
  winners: MoodEntry[];
  losers: MoodEntry[];
  lastUpdated?: number | null;
  totalRows: number;
};

function MoodAuxPanel({ snapshot, winners, losers, lastUpdated, totalRows }: MoodAuxPanelProps) {
  const { accent, label, description, score, amplitude, buckets, dominance } = snapshot;
  const total = buckets.total || 1;
  const positivePct = (buckets.positive / total) * 100;
  const neutralPct = (buckets.neutral / total) * 100;
  const negativePct = (buckets.negative / total) * 100;

  return (
    <aside
      className="relative flex h-full flex-col gap-6 overflow-hidden rounded-3xl border border-white/12 bg-slate-950/85 p-6 shadow-[0_55px_140px_-60px_rgba(8,47,73,0.7)] backdrop-blur"
      style={{
        boxShadow: "0 0 0 1px rgba(148,163,184,0.16), 0 50px 140px -65px rgba(14,116,144,0.55)",
        backgroundImage: `linear-gradient(165deg, ${withAlpha(accent, 0.2)}, rgba(2,6,23,0.92))`,
      }}
    >
      <header className="space-y-2">
        <span
          className="inline-flex items-center gap-2 rounded-full px-3 py-1 text-[11px] uppercase tracking-[0.32em]"
          style={{ background: withAlpha(accent, 0.18), color: accent }}
        >
          mood-aux
        </span>
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="text-2xl font-semibold text-slate-50">Sentiment Vector</h2>
          <span className="text-[11px] uppercase tracking-wide text-slate-400">
            {totalRows} pairs &bull; updated {formatTimestamp(lastUpdated)}
          </span>
        </div>
        <p className="text-sm leading-relaxed text-slate-300">{description}</p>
      </header>

      <section className="space-y-4">
        <div className="grid gap-3">
          <MoodStat label="Avg id_pct" value={formatPercent(score, 7)} accent={accent} />
          <MoodStat label="Spread width" value={formatPercent(amplitude, 7)} accent="#38bdf8" />
          <MoodStat
            label="Bias balance"
            value={
              dominance == null
                ? "-"
                : `${(dominance * 100).toFixed(1)}% ${dominance >= 0 ? "bull" : "bear"}`
            }
            accent={dominance != null && dominance >= 0 ? "#4ade80" : "#f87171"}
          />
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between text-[12px] text-slate-400">
            <span>Distribution</span>
            <span>
              +{buckets.positive} / &asymp;{buckets.neutral} / -{buckets.negative}
            </span>
          </div>
          <div className="flex h-2 w-full overflow-hidden rounded-full bg-slate-900/65">
            <div style={{ width: `${positivePct}%`, background: withAlpha("#22c55e", 0.85) }} />
            <div style={{ width: `${neutralPct}%`, background: withAlpha("#facc15", 0.65) }} />
            <div style={{ width: `${negativePct}%`, background: withAlpha("#f87171", 0.85) }} />
          </div>
        </div>
      </section>

      <section className="grid gap-4 sm:grid-cols-2">
        <MoodList title="Top uplifts" entries={winners} emptyCopy="No positive id_pct yet." />
        <MoodList title="Deep pullbacks" entries={losers} emptyCopy="No negative id_pct yet." />
      </section>
    </aside>
  );
}

function MoodStat({ label, value, accent }: { label: string; value: string; accent: string }) {
  return (
    <div
      className="flex items-center justify-between rounded-2xl border border-white/10 bg-slate-950/60 px-4 py-3"
      style={{
        boxShadow: `0 0 0 1px ${withAlpha(accent, 0.25)}, inset 0 1px 0 rgba(255,255,255,0.1)`,
      }}
    >
      <span className="text-[12px] uppercase tracking-wide text-slate-400">{label}</span>
      <span className="font-mono text-[15px] text-slate-100">{value}</span>
    </div>
  );
}

function MoodList({ title, entries, emptyCopy }: { title: string; entries: MoodEntry[]; emptyCopy: string }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-slate-950/60 p-4">
      <h3 className="text-sm font-semibold uppercase tracking-[0.2em] text-slate-300">{title}</h3>
      <div className="mt-3 space-y-2">
        {entries.length === 0 && <div className="text-xs text-slate-500">{emptyCopy}</div>}
        {entries.map((entry) => (
          <div
            key={entry.pair}
            className="flex items-center justify-between rounded-xl border border-white/5 bg-slate-950/70 px-3 py-2 text-[13px]"
            style={{
              boxShadow: `inset 0 1px 0 rgba(255,255,255,0.06), 0 0 12px ${withAlpha(entry.color, 0.4)}`,
            }}
          >
            <div className="flex items-center gap-2 font-mono text-[12px] text-slate-200">
              <span>{entry.pair}</span>
              <span className={`rounded-full px-2 py-px text-[10px] uppercase ${DERIVATION_BADGE[entry.derivation]}`}>
                {entry.derivation}
              </span>
            </div>
            <span
              className="inline-flex min-w-[72px] justify-end rounded-md px-2 py-1 font-mono text-[12px]"
              style={{
                background: withAlpha(entry.color, 0.7),
                color: textColorForValue(entry.value),
                boxShadow: "inset 0 1px 0 rgba(255,255,255,0.12)",
              }}
            >
              {formatPercent(entry.value, 7)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

type StatCardProps = {
  label: string;
  value: React.ReactNode;
  hint?: string;
  accent?: string;
};

function StatCard({ label, value, hint, accent = "#38bdf8" }: StatCardProps) {
  return (
    <div
      className="rounded-2xl border border-white/10 bg-slate-950/75 p-4 shadow-[0_25px_60px_-40px_rgba(8,47,73,0.65)]"
      style={{
        boxShadow: `0 0 0 1px ${withAlpha(accent, 0.22)}, 0 25px 70px -45px rgba(8,47,73,0.55)`,
      }}
    >
      <div className="text-[11px] uppercase tracking-wide text-slate-400">{label}</div>
      <div className="mt-2 text-2xl font-semibold text-slate-100">{value}</div>
      {hint ? <div className="mt-1 text-[12px] text-slate-500">{hint}</div> : null}
    </div>
  );
}

export default function MatricesClient() {
  const [payload, setPayload] = useState<MatricesLatestResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [previewSymbols, setPreviewSymbols] = useState<string[]>([]);
  const [frozenStreaks, setFrozenStreaks] = useState<Map<string, number>>(() => new Map());
  const { data: settings } = useSettings();

  const fetchLatest = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/matrices/latest", { cache: "no-store" });
      if (!res.ok) {
        throw new Error(`Request failed with status ${res.status}`);
      }
      const json = (await res.json()) as MatricesLatestResponse;
      setPayload(json);
      if (!json?.ok && !json?.error) {
        setError("Latest matrices payload is not ok");
      }
      if (json?.error) {
        setError(json.error);
      }
    } catch (err: any) {
      console.error("[matrices] latest fetch failed", err);
      setPayload(null);
      setError(String(err?.message ?? err ?? "Unknown error"));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchLatest();
  }, [fetchLatest]);

  const autoRefreshEnabled = settings?.timing?.autoRefresh ?? true;
  const pollMs = useMemo(() => {
    const ms = Number(settings?.timing?.autoRefreshMs ?? DEFAULT_POLL_INTERVAL_MS);
    return Number.isFinite(ms) ? Math.max(1_000, ms) : DEFAULT_POLL_INTERVAL_MS;
  }, [settings?.timing?.autoRefreshMs]);

  useEffect(() => {
    if (!autoRefreshEnabled) return;
    const id = setInterval(fetchLatest, pollMs);
    return () => clearInterval(id);
  }, [autoRefreshEnabled, pollMs, fetchLatest]);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const res = await fetch("/api/market/providers/binance/preview", { cache: "no-store" });
        if (!res.ok) return;
        const json = await res.json();
        const symbols = Array.isArray(json)
          ? json
          : Array.isArray(json?.symbols)
          ? json.symbols
          : [];
        if (active) setPreviewSymbols(symbols.map(toUpper));
      } catch (err) {
        console.warn("[matrices] preview fetch failed", err);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  const previewSet = useMemo(() => new Set(previewSymbols), [previewSymbols]);

  const lastFreezeTsRef = useRef<number | null>(null);

  useEffect(() => {
    if (!payload?.ok) return;
    const timestampRaw = payload.matrices?.benchmark?.ts ?? payload.ts ?? null;
    if (typeof timestampRaw !== "number" || !Number.isFinite(timestampRaw)) return;
    if (lastFreezeTsRef.current && timestampRaw <= lastFreezeTsRef.current) return;

    const quoteSymbol = toUpper(payload.quote ?? "USDT");
    const coinsRaw = Array.isArray(payload.coins) ? payload.coins.map(toUpper) : [];
    const bases = coinsRaw.filter((c) => c && c !== quoteSymbol);
    const fullCoins = [quoteSymbol, ...bases];
    const idValues = payload.matrices?.id_pct?.values ?? {};

    setFrozenStreaks((prev) => {
      const next = new Map<string, number>();
      for (const base of fullCoins) {
        for (const quote of fullCoins) {
          if (base === quote) continue;
          const rawValue = idValues?.[base]?.[quote];
          if (rawValue === null || rawValue === undefined) continue;
          const num = Number(rawValue);
          if (!Number.isFinite(num) || Math.abs(num) > FROZEN_EPSILON) continue;
          const key = pairKey(base, quote);
          const streak = (prev.get(key) ?? 0) + 1;
          next.set(key, streak);
        }
      }
      return next;
    });

    lastFreezeTsRef.current = timestampRaw;
  }, [payload]);

  const rows = useMemo<ApiMatrixRow[]>(() => {
    return buildMatrixRows({ payload, previewSet, frozenStreaks });
  }, [payload, previewSet, frozenStreaks]);

  const coins = useMemo<string[]>(() => {
    if (!Array.isArray(payload?.coins)) return [];
    return payload.coins.map(toUpper);
  }, [payload?.coins]);

  const quote = toUpper(payload?.quote ?? "USDT");
  const benchmarkTs = payload?.matrices?.benchmark?.ts;
  const mood = useMemo(() => computeMood(rows), [rows]);
  const winners = useMemo(() => selectTop(rows, "winners"), [rows]);
  const losers = useMemo(() => selectTop(rows, "losers"), [rows]);

  const statusLabel = payload?.ok ? "operational" : "awaiting signal";
  const statusAccent = payload?.ok ? "#4ade80" : "#facc15";

  return (
    <div
      className="min-h-dvh bg-[#020618] text-slate-100"
      style={{
        backgroundImage:
          "radial-gradient(circle at 15% 20%, rgba(56,189,248,0.18), transparent 55%), radial-gradient(circle at 85% 25%, rgba(168,85,247,0.14), transparent 60%), linear-gradient(180deg, rgba(2,6,23,0.95), rgba(15,23,42,0.92))",
      }}
    >
      <main className="relative mx-auto flex min-h-dvh max-w-7xl flex-col gap-8 px-4 py-10 lg:px-10">
        <header
          className="relative overflow-hidden rounded-3xl border border-white/12 bg-slate-950/80 p-6 shadow-[0_60px_140px_-70px_rgba(8,47,73,0.75)] backdrop-blur"
          style={{
            boxShadow: "0 0 0 1px rgba(148,163,184,0.14), 0 60px 140px -80px rgba(8,47,73,0.7)",
          }}
        >
          <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between">
            <div className="space-y-3">
              <span className="inline-flex items-center gap-2 rounded-full bg-slate-900/60 px-3 py-1 text-[11px] uppercase tracking-[0.32em] text-slate-400">
                matrix control
              </span>
              <h1 className="text-3xl font-semibold text-slate-50">Matrices Observatory</h1>
              <p className="max-w-2xl text-sm leading-relaxed text-slate-300">
                Full projection of the seven benchmark derivatives fused with mood-aux so every pair&apos;s trajectory,
                drift, and delta can be audited in one viewport.
              </p>
            </div>

            <div className="flex items-center gap-2 self-start">
              <a
                className="inline-flex items-center rounded-full border border-white/20 bg-slate-900/70 px-4 py-2 text-xs uppercase tracking-[0.22em] text-slate-200 transition hover:border-white/40"
                href="/api/matrices/latest"
                rel="noreferrer"
                target="_blank"
              >
                API
              </a>
              <button
                className="inline-flex items-center rounded-full bg-emerald-500/80 px-5 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-emerald-950 transition hover:bg-emerald-400 disabled:cursor-not-allowed disabled:bg-slate-700/70 disabled:text-slate-400"
                disabled={loading}
                onClick={fetchLatest}
              >
                {loading ? "Fetching..." : "Refresh"}
              </button>
            </div>
          </div>

          <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard label="Pairs tracked" value={rows.length} hint={`${coins.length} assets | quote ${quote}`} />
            <StatCard label="Benchmark stamp" value={formatTimestamp(benchmarkTs)} hint="UTC / local time" accent="#facc15" />
            <StatCard label="Mood regime" value={mood.label} hint={formatPercent(mood.score, 7)} accent={mood.accent} />
            <StatCard label="Status" value={statusLabel} accent={statusAccent} hint={error ?? undefined} />
          </div>

          <div className="mt-6 flex flex-wrap items-center gap-4 text-[11px] uppercase tracking-wide text-slate-400">
            {RING_LEGEND.map((item) => (
              <span key={item.label} className="flex items-center gap-2">
                <i
                  className={item.square ? "h-2.5 w-2.5 rounded-sm" : "h-2.5 w-2.5 rounded-full"}
                  style={{
                    background: item.color,
                    boxShadow: `0 0 10px ${withAlpha(item.color, 0.55)}`,
                  }}
                />
                {item.label}
              </span>
            ))}
            {error && <span className="rounded-full border border-rose-500/50 px-3 py-1 text-rose-300">error: {error}</span>}
          </div>
        </header>

        <section className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
          <Matrices rows={rows} />
          <MoodAuxPanel snapshot={mood} winners={winners} losers={losers} lastUpdated={benchmarkTs} totalRows={rows.length} />
        </section>
      </main>
    </div>
  );
}



