"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import Matrix, { type MatrixCell } from "@/components/features/matrices/Matrix";
import MeaAuxCard from "@/components/features/mea-aux/MeaAuxCard";
import { withAlpha, type FrozenStage } from "@/components/features/matrices/colors";
import CinMatricesPanel from "@/components/features/cin-aux/CinMatricesPanel";

import {
  MUTED_BACKGROUND,
  NEGATIVE_SHADES,
  POSITIVE_SHADES,
  PREVIEW_RING_COLORS,
  FROZEN_RING_COLORS,
  SIGN_FLIP_RING_COLORS,
  loadPreviewSymbolSet,
  resolveCellPresentation,
  type MatrixColorRules,
} from "@/app/matrices/colouring";
import { useSettings, selectCoins } from "@/lib/settings/client";

const DEFAULT_POLL_MS = 40_000;

const FROZEN_EPSILON = 1e-8;
const STREAK_MID_THRESHOLD = 3;
const STREAK_LONG_THRESHOLD = 6;


const PAGE_BACKGROUND =
  "linear-gradient(180deg, rgba(14,16,24,0.96), rgba(8,10,18,0.98)), radial-gradient(circle at 18% 18%, rgba(56,189,248,0.16), transparent 55%), radial-gradient(circle at 82% 12%, rgba(244,114,182,0.14), transparent 60%)";

const FROZEN_RING_LEGEND: Array<{ stage: FrozenStage; label: string }> = [
  { stage: "recent", label: "frozen ≤2 cycles" },
  { stage: "mid", label: "frozen 3-6 cycles" },
  { stage: "long", label: "frozen >6 cycles" },
];

const RING_LEGEND = [
  { color: PREVIEW_RING_COLORS.direct, label: "preview direct" },
  { color: PREVIEW_RING_COLORS.inverse, label: "preview inverse" },
  { color: PREVIEW_RING_COLORS.missing, label: "preview missing" },
  ...FROZEN_RING_LEGEND.map(({ stage, label }) => ({
    color: FROZEN_RING_COLORS[stage],
    label,
  })),
  { color: SIGN_FLIP_RING_COLORS.minusToPlus, label: "- to +" },
  { color: SIGN_FLIP_RING_COLORS.plusToMinus, label: "+ to -" },
] as const;
const CARD_GRADIENTS: Record<MatrixKey, string> = {
  benchmark: "linear-gradient(140deg, rgba(76,201,240,0.18), rgba(12,16,32,0.92))",
  delta: "linear-gradient(140deg, rgba(255,129,102,0.18), rgba(12,16,32,0.92))",
  pct24h: "linear-gradient(140deg, rgba(102,126,234,0.20), rgba(14,16,34,0.92))",
  id_pct: "linear-gradient(140deg, rgba(129,199,132,0.18), rgba(11,14,26,0.92))",
  pct_drv: "linear-gradient(140deg, rgba(255,198,73,0.20), rgba(15,19,32,0.92))",
  pct_ref: "linear-gradient(140deg, rgba(236,72,153,0.22), rgba(12,18,32,0.92))",
  ref: "linear-gradient(140deg, rgba(45,212,191,0.20), rgba(10,14,26,0.92))",
};


const BENCHMARK_THRESHOLDS: readonly number[] = [0.0005, 0.0015, 0.003];
const DELTA_THRESHOLDS: readonly number[] = [0.0005, 0.001, 0.0025];
const EXTENDED_THRESHOLDS: readonly number[] = [0.0025, 0.005, 0.01, 0.02, 0.04];
const PCT_THRESHOLDS: readonly number[] = [0.01, 0.02, 0.04, 0.08, 0.16];
const REF_THRESHOLDS: readonly number[] = [0.003, 0.006, 0.012, 0.024, 0.048];

const defaultSessionId = process.env.NEXT_PUBLIC_CIN_DEFAULT_SESSION_ID || "";


type MatValues = Record<string, Record<string, number | null | undefined>>;

type MatrixKey =
  | "benchmark"
  | "pct24h"
  | "id_pct"
  | "pct_drv"
  | "pct_ref"
  | "ref"
  | "delta";

type MatrixSlice = {
  ts: number;
  values: MatValues;
  flags?: MatrixFlags;
};

type MatricesLatestSuccessPayload = {
  ok: true;
  coins: string[];
  symbols: string[];
  quote: string;
  window: "15m" | "30m" | "1h";
  ts: number;
  matrices: Record<MatrixKey, MatrixSlice> & {
    benchmark: MatrixSlice & { flags?: MatrixFlags };
    pct24h: MatrixSlice & { flags?: MatrixFlags };
  };
  meta: {
    openingTs: number | null;
    universe: string[];
    availability?: {
      symbols: string[];
      pairs: Array<{ symbol: string; base: string; quote: string }>;
    };
  };
};

type MatricesLatestErrorPayload = {
  ok: false;
  error: string;
};

type MatricesLatestResponse = MatricesLatestSuccessPayload | MatricesLatestErrorPayload;

type MatrixFlags = {
  frozen?: boolean[][];
  frozenSymbols?: Record<string, boolean>;
};

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

type MatrixDescriptor = MatrixColorRules & {
  key: MatrixKey;
  title: string;
  positivePalette: readonly string[];
  negativePalette: readonly string[];
  format: (value: number | null) => string;
};

const formatDecimal = (digits: number, minimum = 0) => {
  const formatter = new Intl.NumberFormat("en-US", {
    minimumFractionDigits: minimum,
    maximumFractionDigits: digits,
  });
  return (value: number | null) => {
    if (value == null || !Number.isFinite(value)) return "–";
    return formatter.format(value);
  };
};

const formatPercent = (digits: number) => {
  const formatter = new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: digits,
  });
  return (value: number | null) => {
    if (value == null || !Number.isFinite(value)) return "–";
    return `${formatter.format(value * 100)}%`;
  };
};

const MATRIX_DESCRIPTORS: readonly MatrixDescriptor[] = [
  {
    key: "benchmark",
    title: "benchmark",
    thresholds: BENCHMARK_THRESHOLDS,
    positivePalette: POSITIVE_SHADES,
    negativePalette: NEGATIVE_SHADES,
    zeroFloor: 0.0001,
    derive: (value) => (value == null ? null : value - 1),
    format: formatDecimal(4, 2),
    ringStrategy: "preview",
  },
  {
    key: "delta",
    title: "delta",
    thresholds: DELTA_THRESHOLDS,
    positivePalette: POSITIVE_SHADES,
    negativePalette: NEGATIVE_SHADES,
    zeroFloor: 0.00008,
    derive: (value) => value,
    format: formatDecimal(4, 2),
    ringStrategy: "preview",
  },
  {
    key: "pct24h",
    title: "pct24h",
    thresholds: PCT_THRESHOLDS,
    positivePalette: POSITIVE_SHADES,
    negativePalette: NEGATIVE_SHADES,
    zeroFloor: 0.0005,
    derive: (value) => value,
    format: formatPercent(2),
    ringStrategy: "preview",
  },
  {
    key: "id_pct",
    title: "id_pct",
    thresholds: EXTENDED_THRESHOLDS,
    positivePalette: POSITIVE_SHADES,
    negativePalette: NEGATIVE_SHADES,
    zeroFloor: 0.00025,
    derive: (value) => value,
    format: formatDecimal(4, 2),
    ringStrategy: "preview",
  },
  {
    key: "pct_drv",
    title: "pct_drv",
    thresholds: EXTENDED_THRESHOLDS,
    positivePalette: POSITIVE_SHADES,
    negativePalette: NEGATIVE_SHADES,
    zeroFloor: 0.00025,
    derive: (value) => value,
    format: formatDecimal(4, 2),
    ringStrategy: "sign-flip",
  },
  {
    key: "pct_ref",
    title: "pct_ref",
    thresholds: PCT_THRESHOLDS,
    positivePalette: POSITIVE_SHADES,
    negativePalette: NEGATIVE_SHADES,
    zeroFloor: 0.0004,
    derive: (value) => value,
    format: formatPercent(2),
    ringStrategy: "sign-flip",
  },
  {
    key: "ref",
    title: "ref",
    thresholds: REF_THRESHOLDS,
    positivePalette: POSITIVE_SHADES,
    negativePalette: NEGATIVE_SHADES,
    zeroFloor: 0.0002,
    derive: (value) => (value == null ? null : value - 1),
    format: formatDecimal(4, 2),
    ringStrategy: "sign-flip",
  },
];

const buildQueryString = (params: URLSearchParams): string => {
  const query = new URLSearchParams();

  const coinsParams = params.getAll("coins");
  if (coinsParams.length > 1) {
    query.set(
      "coins",
      coinsParams
        .map((c) => c.trim())
        .filter(Boolean)
        .join(",")
    );
  } else {
    const coins = params.get("coins");
    if (coins) query.set("coins", coins);
  }

  const quote = params.get("quote");
  if (quote) query.set("quote", quote);

  const windowParam = params.get("window");
  if (windowParam) query.set("window", windowParam);

  const appSessionId = params.get("appSessionId");
  if (appSessionId) query.set("appSessionId", appSessionId);

  return query.toString();
};

export default function MatricesPage() {
  const searchParams = useSearchParams();
  const queryString = useMemo(() => buildQueryString(searchParams), [searchParams]);
  const pollMs = useMemo(() => {
    const raw = Number(searchParams.get("pollMs"));
    if (Number.isFinite(raw) && raw >= 5_000) return raw;
    return DEFAULT_POLL_MS;
  }, [searchParams]);

  const { data: clientSettings } = useSettings();

  const [payload, setPayload] = useState<MatricesLatestSuccessPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [previewSymbolSet, setPreviewSymbolSet] = useState<Set<string>>(() => new Set());
  const [frozenStreaks, setFrozenStreaks] = useState<Map<string, number>>(() => new Map());

  const prevValuesRef = useRef<Partial<Record<MatrixKey, (number | null)[][]>>>({});
  const lastFreezeTsRef = useRef<number | null>(null);
  const availableSymbolSet = useMemo(() => {
    const availabilitySymbols = payload?.meta?.availability?.symbols;
    const fallbackSymbols = payload?.symbols;
    const source = availabilitySymbols && availabilitySymbols.length ? availabilitySymbols : fallbackSymbols ?? [];
    const set = new Set<string>();
    for (const sym of source ?? []) {
      set.add(String(sym ?? "").toUpperCase());
    }
    return set;
  }, [payload]);

  const fetchLatest = useCallback(async () => {
    setLoading(true);
    try {
      const qs = queryString ? `?${queryString}&t=${Date.now()}` : `?t=${Date.now()}`;
      const res = await fetch(`/api/matrices/latest${qs}`, { cache: "no-store" });
      const json = (await res.json()) as MatricesLatestResponse;
      if (!json.ok) throw new Error(json.error || `matrices latest ${res.status}`);
      setPayload(json);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [queryString]);

  useEffect(() => {
    fetchLatest();
    const id = setInterval(fetchLatest, pollMs);
    return () => clearInterval(id);
  }, [fetchLatest, pollMs]);

  const fallbackCoins = useMemo(() => selectCoins(clientSettings ?? null), [clientSettings]);

  const coins = useMemo(() => {
    if (payload) {
      const universe = payload.meta?.universe ?? [];
      if (universe.length) return universe.map((c) => c.toUpperCase());
      const quote = (payload.quote ?? "USDT").toUpperCase();
      const bases = (payload.coins ?? []).map((c) => c.toUpperCase()).filter(Boolean);
      return [quote, ...bases.filter((c) => c !== quote)];
    }
    return fallbackCoins;
  }, [payload, fallbackCoins]);

  const coinsKey = coins.join("|");
  const meaDefaultK = useMemo(() => (coins.length > 1 ? Math.max(1, coins.length - 1) : 7), [coins.length]);

  useEffect(() => {
    let active = true;
    if (!coins.length) {
      setPreviewSymbolSet(new Set());
      return () => {
        active = false;
      };
    }

    (async () => {
      try {
        const { set } = await loadPreviewSymbolSet(coins);
        if (!active) return;
        setPreviewSymbolSet(new Set(set));
      } catch {
        if (!active) return;
        setPreviewSymbolSet(new Set());
      }
    })();

    return () => {
      active = false;
    };
  }, [coinsKey, coins]);

  useEffect(() => {
    if (!payload?.ok || !coins.length) return;
    const timestampRaw = payload.matrices?.benchmark?.ts ?? payload.ts ?? null;
    if (typeof timestampRaw !== "number" || !Number.isFinite(timestampRaw)) return;
    if (lastFreezeTsRef.current && timestampRaw <= lastFreezeTsRef.current) return;

    const idValues = payload.matrices?.id_pct?.values ?? {};
    setFrozenStreaks((prev) => {
      const next = new Map<string, number>();
      for (let i = 0; i < coins.length; i++) {
        const base = coins[i]!;
        for (let j = 0; j < coins.length; j++) {
          if (i === j) continue;
          const quote = coins[j]!;
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
  }, [payload, coinsKey, coins.length]);

  const currentGrids = useMemo(() => {
    if (!payload || !coins.length) return null;

    const toGrid = (values?: MatValues): (number | null)[][] =>
      coins.map((base) =>
        coins.map((quote) => {
          if (base === quote) return null;
          const raw = values?.[base]?.[quote];
          const num = Number(raw);
          return Number.isFinite(num) ? num : null;
        })
      );

    return {
      benchmark: toGrid(payload.matrices.benchmark.values),
      pct24h: toGrid(payload.matrices.pct24h.values),
      id_pct: toGrid(payload.matrices.id_pct.values),
      pct_drv: toGrid(payload.matrices.pct_drv.values),
      pct_ref: toGrid(payload.matrices.pct_ref.values),
      ref: toGrid(payload.matrices.ref.values),
      delta: toGrid(payload.matrices.delta.values),
    } satisfies Record<MatrixKey, (number | null)[][]>;
  }, [payload, coinsKey, coins.length]);

  const frozenSymbolFlags = useMemo(() => {
    if (!payload) return {};
    const flags = (payload.matrices.benchmark.flags ?? {}) as MatrixFlags;
    const raw = flags?.frozenSymbols ?? {};
    const normalized: Record<string, boolean> = {};
    for (const [key, value] of Object.entries(raw)) {
      normalized[normalizeKey(key)] = Boolean(value);
    }
    return normalized;
  }, [payload]);

  const frozenStreakGrid = useMemo(() => {
    if (!coins.length) return null;
    return coins.map((base) =>
      coins.map((quote) => {
        if (base === quote) return 0;
        const key = pairKey(base, quote);
        return frozenStreaks.get(key) ?? 0;
      })
    );
  }, [coinsKey, coins.length, frozenStreaks]);

  useEffect(() => {
    if (currentGrids) {
      prevValuesRef.current = currentGrids;
    }
  }, [currentGrids]);

  const matrixCards = useMemo(() => {
    if (!payload || !currentGrids) return [];

    const symbolSet = availableSymbolSet;

    return MATRIX_DESCRIPTORS.map((descriptor) => {
      const grid = currentGrids[descriptor.key];
      if (!grid) return null;

      const slice = payload.matrices[descriptor.key];
      const timestamp = slice?.ts ?? payload.ts;
      const prevGrid = prevValuesRef.current[descriptor.key];

      const cells: MatrixCell[][] = coins.map((base, i) =>
        coins.map((quote, j) => {
          if (i === j) {
            return {
              value: null,
              display: "-",
              background: MUTED_BACKGROUND,
              polarity: "neutral",
              ringColor: null,
              tooltip: `${base}/${quote}`,
              isDiagonal: true,
            } satisfies MatrixCell;
          }

          const raw = grid?.[i]?.[j];
          const value = Number.isFinite(raw as number) ? (raw as number) : null;
          const prevRaw = prevGrid?.[i]?.[j];
          const prevValue =
            prevGrid !== undefined ? (Number.isFinite(prevRaw as number) ? (prevRaw as number) : null) : undefined;
          const streak = frozenStreakGrid?.[i]?.[j] ?? 0;
          const cellStage = streakToStage(streak);
          const symbolFrozen = isSymbolFrozen(frozenSymbolFlags, base, quote);
          const effectiveStage: FrozenStage | null = symbolFrozen ? "long" : cellStage;
          const isFrozen = Boolean(effectiveStage);
          const directSymbol = `${base}${quote}`;
          const inverseSymbol = `${quote}${base}`;

          const presentation = resolveCellPresentation({
            rules: descriptor,
            value,
            prevValue,
            frozen: isFrozen,
            frozenStage: effectiveStage,
            directSymbol,
            inverseSymbol,
            symbolSets: {
              preview: previewSymbolSet,
              payload: symbolSet,
            },
          });

          const display = descriptor.format(value);
          const tooltipBase = `${base}/${quote} -> ${display}`;
          const tooltip =
            isFrozen && effectiveStage ? `${tooltipBase} (${effectiveStage} freeze)` : tooltipBase;

          return {
            value,
            display,
            background: presentation.background,
            polarity: presentation.polarity,
            ringColor: presentation.ringColor,
            tooltip,
            textColor: presentation.textColor,
            frozen: isFrozen,
            frozenStage: effectiveStage,
          } satisfies MatrixCell;
        })
      );

      return {
        key: descriptor.key,
        props: {
          title: descriptor.title,
          coins,
          cells,
          timestamp,
          gradient: CARD_GRADIENTS[descriptor.key],
        },
      };
    })
      .filter(Boolean) as Array<{ key: MatrixKey; props: Parameters<typeof Matrix>[0] }>;
  }, [payload, currentGrids, coins, previewSymbolSet, frozenStreakGrid, frozenSymbolFlags, availableSymbolSet]);


  const lastUpdated = payload?.ts ?? null;
  const quote = (payload?.quote ?? "USDT").toUpperCase();
  const windowLabel = payload?.window?.toUpperCase() ?? "—";

  const statusLabel = error ? "degraded" : loading ? "refreshing" : payload ? "operational" : "awaiting data";
  const statusColor = error ? "#f97316" : loading ? "#38bdf8" : "#22c55e";

  const stats = [
    {
      label: "Universe",
      value: coins.length ? `${coins.length} assets` : "—",
      hint: coins.length ? coins.join(" • ") : "no coins resolved",
    },
    {
      label: "Quote",
      value: quote,
      hint: `window ${windowLabel}`,
    },
    {
      label: "Tradable pairs",
      value: availableSymbolSet.size ? `${availableSymbolSet.size}` : "0",
      hint: "market/pairs availability",
    },
    {
      label: "Preview markets",
      value: previewSymbolSet.size ? `${previewSymbolSet.size}` : "0",
      hint: "symbols in preview feed",
    },
    {
      label: "Last update",
      value: lastUpdated ? new Date(lastUpdated).toLocaleString() : "—",
      hint: "UTC / local",
      accent: "#facc15",
    },
  ];

  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-100" style={{ backgroundImage: PAGE_BACKGROUND }}>
      <main className="mx-auto w-full max-w-none px-6 py-12 lg:px-12">
        <header className="rounded-3xl border border-white/10 bg-neutral-900/60 p-8 shadow-[0_60px_120px_-70px_rgba(15,23,42,0.85)] backdrop-blur">
          <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
            <div className="space-y-3">
              <span className="inline-flex items-center rounded-full bg-white/5 px-3 py-1 text-[11px] uppercase tracking-[0.32em] text-slate-300">
                matrices
              </span>
              <h1 className="text-3xl font-semibold text-slate-50 md:text-4xl">Matrices</h1>
              <p className="max-w-2xl text-sm leading-relaxed text-slate-300">
                Seven matrices rendered in raw decimals (pct24h/pct_ref in %), with amber zeroes and purple freezes; preview rings stay green/red/grey.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-3 self-start">
              <button
                type="button"
                onClick={fetchLatest}
                disabled={loading}
                className="inline-flex items-center rounded-full bg-emerald-500/80 px-5 py-2 text-xs font-semibold uppercase tracking-[0.24em] text-emerald-950 transition hover:bg-emerald-400 disabled:cursor-not-allowed disabled:bg-slate-700/70 disabled:text-slate-400"
              >
                {loading ? "Refreshing…" : "Refresh"}
              </button>
              <a
                className="inline-flex items-center rounded-full border border-white/20 bg-white/5 px-4 py-2 text-xs uppercase tracking-[0.2em] text-slate-200 transition hover:border-white/40"
                href="/api/matrices/latest"
                rel="noreferrer"
                target="_blank"
              >
                API
              </a>
              <div className="max-w-6xl mx-auto p-6 space-y-8">
      <h1 className="text-2xl font-bold">Matrices</h1>
      <p className="text-sm text-gray-600">
        Manage CIN-AUX operations and view τ (imprint − luggage) per move.
      </p>
      <CinMatricesPanel defaultSessionId={defaultSessionId} />
    </div>
              <span
                className="rounded-full px-4 py-2 text-[11px] uppercase tracking-[0.28em]"
                style={{
                  color: statusColor,
                  border: `1px solid ${withAlpha(statusColor, 0.45)}`,
                  background: withAlpha(statusColor, 0.14),
                }}
              >
                {statusLabel}
              </span>
            </div>
          </div>

          <div className="mt-8 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {stats.map((item) => (
              <StatCard key={item.label} {...item} />
            ))}
          </div>

          <div className="mt-8 flex flex-wrap items-center gap-4 text-[11px] uppercase tracking-[0.22em] text-slate-400">
            {RING_LEGEND.map((item) => (
              <span key={item.label} className="flex items-center gap-2">
                <i
                  className="h-2.5 w-2.5 rounded-full"
                  style={{
                    background: item.color,
                    boxShadow: `0 0 12px ${withAlpha(item.color, 0.55)}`,
                  }}
                />
                {item.label}
              </span>
            ))}
            <span className="text-slate-500">poll {Math.round(pollMs / 1000)}s</span>
            {error ? (
              <span className="rounded-full border border-amber-500/40 px-3 py-1 text-amber-200">{error}</span>
            ) : null}
          </div>
        </header>

        <section className="mt-10 w-full">
          <MeaAuxCard coins={coins} defaultK={meaDefaultK} autoRefreshMs={60_000} />
        </section>

        <section className="mt-10 grid w-full gap-6 sm:grid-cols-2">
          {matrixCards.length ? (
            matrixCards.map(({ key, props }) => <Matrix key={key} {...props} />)
          ) : (
            <EmptyState />
          )}
        </section>
      </main>
    </div>
  );
}

function StatCard({
  label,
  value,
  hint,
  accent,
}: {
  label: string;
  value: string;
  hint?: string;
  accent?: string;
}) {
  const highlight = accent ?? "#38bdf8";
  return (
    <article
      className="rounded-2xl border border-white/10 bg-white/5 p-4 shadow-inner"
      style={{
        boxShadow: `inset 0 1px 0 rgba(255,255,255,0.12), 0 12px 32px -20px ${withAlpha(highlight, 0.6)}`,
      }}
    >
      <div className="text-[11px] uppercase tracking-[0.28em] text-slate-400">{label}</div>
      <div className="mt-1 text-lg font-semibold text-slate-100">{value}</div>
      {hint ? <div className="mt-1 text-xs text-slate-400">{hint}</div> : null}
    </article>
  );
}

function EmptyState() {
  return (
    <div className="col-span-full rounded-3xl border border-dashed border-white/10 bg-neutral-900/40 p-10 text-center text-slate-400">
      Matrices will appear here once the latest snapshot arrives.
    </div>
  );
}















