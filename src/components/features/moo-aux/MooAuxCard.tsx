"use client";

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import Matrix, { type MatrixCell } from "@/components/features/matrices/Matrix";
import { withAlpha, COLOR_AMBER, NULL_SENSITIVITY } from "@/components/features/matrices/colors";

const FALLBACK_COINS: string[] = ["BTC", "ETH", "BNB", "SOL", "ADA", "XRP", "PEPE", "USDT"];
const CARD_GRADIENT =
  "linear-gradient(150deg, rgba(21,94,239,0.12), rgba(2,6,23,0.94)), radial-gradient(circle at 12% 18%, rgba(56,189,248,0.18), transparent 58%)";
const MIN_REFRESH_MS = 15_000;

type Props = {
  coins?: string[];
  defaultK?: number;
  autoRefreshMs?: number;
  className?: string;
};

type MooAuxGrid = Record<string, Record<string, number | null | undefined>>;

type MooAuxSources = {
  coins?: string;
  id_pct?: string;
  balances?: string;
};

type MooPerSymbolEntry = {
  uuid?: string;
  [key: string]: unknown;
};

type MooPerSymbolMood = Record<string, Record<string, MooPerSymbolEntry>>;

type MooMoodPayload = {
  perSymbol?: MooPerSymbolMood;
};

type MooAuxSuccess = {
  ok: true;
  ts_ms?: number;
  coins?: string[];
  k?: number;
  grid?: MooAuxGrid;
  id_pct?: MooAuxGrid;
  sources?: MooAuxSources;
  mood?: MooMoodPayload;
  availability?: {
    symbols?: string[];
    pairs?: Array<{ symbol: string; base: string; quote: string }>;
  };
};

type MooAuxFailure = { ok: false; error?: string };

type MooAuxResponse = MooAuxSuccess | MooAuxFailure;

function coinsEqual(a: string[], b: string[]): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

export default function MooAuxCard({
  coins = FALLBACK_COINS,
  defaultK = 7,
  autoRefreshMs = 45_000,
  className = "",
}: Props) {
  const normalizedCoins = useMemo(() => sanitizeCoins(coins, FALLBACK_COINS), [coins]);
  const [coinUniverse, setCoinUniverse] = useState<string[]>(normalizedCoins);
  const [cells, setCells] = useState<MatrixCell[][]>(() =>
    buildMatrixCells(normalizedCoins, {}, {}, {}, defaultK, null)
  );
  const [timestamp, setTimestamp] = useState<number | null>(null);
  const [kValue, setKValue] = useState<number | null>(null);
  const [sources, setSources] = useState<MooAuxSources | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(false);

  const aliveRef = useRef(true);
  useEffect(() => () => {
    aliveRef.current = false;
  }, []);

  useEffect(() => {
    setCoinUniverse((prev) => {
      if (coinsEqual(prev, normalizedCoins)) return prev;
      setCells(buildMatrixCells(normalizedCoins, {}, {}, {}, defaultK, null));
      return normalizedCoins;
    });
  }, [normalizedCoins, defaultK]);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      params.set("t", Date.now().toString());
      params.set("k", String(Math.max(1, defaultK)));
      if (normalizedCoins.length) params.set("coins", normalizedCoins.join(","));

      const res = await fetch(`/api/moo-aux?${params.toString()}`, { cache: "no-store" });
      if (!res.ok) {
        throw new Error(`moo-aux responded with status ${res.status}`);
      }
      const payload: MooAuxResponse = await res.json();
      if (!payload.ok) {
        throw new Error(payload.error ?? "moo-aux unavailable");
      }

      const payloadCoins = resolveCoins(payload.coins, normalizedCoins);
      const normalizedBalances = normalizeBalances(payload.balances ?? {});
      const fallbackDivisor = Math.max(
        1,
        payloadCoins.length > 1 ? payloadCoins.length - 1 : defaultK
      );
      const divisor =
        typeof payload.k === "number" && Number.isFinite(payload.k) && payload.k > 0
          ? Math.floor(payload.k)
          : null;
      const effectiveK = divisor ?? fallbackDivisor;
      const perSymbolMood = normalizePerSymbolMood(payload.mood?.perSymbol);
      const nextCells = buildMatrixCells(
        payloadCoins,
        payload.grid ?? {},
        payload.id_pct ?? {},
        normalizedBalances,
        effectiveK,
        perSymbolMood
      );

      if (!aliveRef.current) return;
      setCoinUniverse(payloadCoins);
      setCells(nextCells);
      setTimestamp(payload.ts_ms ?? Date.now());
      setKValue(effectiveK);
      setSources(payload.sources ?? null);
      setError(null);
    } catch (err) {
      if (!aliveRef.current) return;
      const message = err instanceof Error ? err.message : String(err ?? "moo-aux unavailable");
      setError(message);
    } finally {
      if (!aliveRef.current) return;
      setLoading(false);
    }
  }, [defaultK, normalizedCoins]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    const interval = Math.max(MIN_REFRESH_MS, autoRefreshMs);
    const id = setInterval(() => {
      void refresh();
    }, interval);
    return () => clearInterval(id);
  }, [autoRefreshMs, refresh]);

  const footer = useMemo(() => {
    const refreshLabel = loading ? "Refreshing…" : "Refresh";
    const intervalLabel = `${Math.round(Math.max(MIN_REFRESH_MS, autoRefreshMs) / 1000)}s`;
    const chips: Array<ReactNode> = [
      <button
        key="refresh"
        type="button"
        onClick={() => {
          void refresh();
        }}
        disabled={loading}
        className="inline-flex items-center rounded-full border border-sky-400/60 bg-sky-500/20 px-3 py-1 text-[10px] uppercase tracking-[0.24em] text-sky-200 transition hover:bg-sky-500/30 disabled:opacity-60"
      >
        {refreshLabel}
      </button>,
      <span key="auto" className="uppercase tracking-[0.22em] text-[10px] text-slate-400">
        auto {intervalLabel}
      </span>,
      <span key="k" className="uppercase tracking-[0.22em] text-[10px] text-slate-400">
        k {kValue ?? defaultK}
      </span>,
    ];

    if (sources) {
      chips.push(
        <span key="src-coins" className="uppercase tracking-[0.22em] text-[10px] text-slate-500">
          coins {sources.coins ?? "-"}
        </span>,
        <span key="src-id" className="uppercase tracking-[0.22em] text-[10px] text-slate-500">
          id_pct {sources.id_pct ?? "-"}
        </span>,
        <span key="src-bal" className="uppercase tracking-[0.22em] text-[10px] text-slate-500">
          balances {sources.balances ?? "-"}
        </span>
      );
    }

    if (error) {
      chips.push(
        <span key="err" className="text-[10px] uppercase tracking-[0.22em] text-amber-300">
          {error}
        </span>
      );
    }

    return <div className="flex flex-wrap items-center gap-3">{chips}</div>;
  }, [autoRefreshMs, defaultK, error, kValue, loading, refresh, sources]);

  const hasMatrix = coinUniverse.length > 0;

  return (
    <div className={`w-full ${className}`}>
      {hasMatrix ? (
        <Matrix
          title="MEA-AUX Allocation Matrix"
          subtitle="MEA-AUX"
          description="First line shows the MEA delta; second line shows the tier-adjusted weight applied to that pair. Darker shades represent larger allocations."
          coins={coinUniverse}
          cells={cells}
          timestamp={timestamp}
          gradient={CARD_GRADIENT}
          footer={footer}
        />
      ) : (
        <div className="rounded-3xl border border-white/10 bg-neutral-900/60 p-6 text-sm text-slate-300">
          MEA-AUX matrix pending data.
        </div>
      )}
    </div>
  );
}

function sanitizeCoins(input: string[] | undefined, fallback: string[]): string[] {
  const primary = (input ?? [])
    .map((coin) => String(coin ?? "").trim().toUpperCase())
    .filter(Boolean);
  if (primary.length) return primary;
  const secondary = fallback
    .map((coin) => String(coin ?? "").trim().toUpperCase())
    .filter(Boolean);
  return secondary.length ? secondary : FALLBACK_COINS;
}

function resolveCoins(payloadCoins: unknown, fallback: string[]): string[] {
  if (Array.isArray(payloadCoins)) {
    const sanitized = payloadCoins
      .map((coin) => String(coin ?? "").trim().toUpperCase())
      .filter(Boolean);
    if (sanitized.length) return sanitized;
  }
  return fallback.length ? fallback : FALLBACK_COINS;
}

function normalizeBalances(input: Record<string, number | null | undefined>): Record<string, number> {
  const out: Record<string, number> = {};
  if (!input) return out;
  for (const [rawKey, rawValue] of Object.entries(input)) {
    const key = String(rawKey ?? "").trim().toUpperCase();
    if (!key) continue;
    const val = Number(rawValue);
    if (!Number.isFinite(val)) continue;
    out[key] = val;
  }
  return out;
}

function normalizePerSymbolMood(input?: MooPerSymbolMood | null): MooPerSymbolMood | null {
  if (!input) return null;
  const out: MooPerSymbolMood = {};
  for (const [quoteRaw, baseMap] of Object.entries(input)) {
    const quote = String(quoteRaw ?? "").toUpperCase();
    if (!quote) continue;
    if (!baseMap || typeof baseMap !== "object") continue;
    for (const [baseRaw, entry] of Object.entries(baseMap)) {
      const base = String(baseRaw ?? "").toUpperCase();
      if (!base) continue;
      if (!out[quote]) out[quote] = {};
      out[quote]![base] = { uuid: entry?.uuid };
    }
  }
  return Object.keys(out).length ? out : null;
}

function buildMatrixCells(
  coins: string[],
  grid: MooAuxGrid,
  idPct: MooAuxGrid,
  balances: Record<string, number>,
  divisor: number,
  perSymbolMood: MooPerSymbolMood | null
): MatrixCell[][] {
  if (!coins.length) return [];

  let maxAbsWeight = 0;
  for (const base of coins) {
    for (const quote of coins) {
      if (base === quote) continue;
      const weight = resolveNumeric(grid?.[base]?.[quote]);
      if (weight != null) {
        const abs = Math.abs(weight);
        if (abs > maxAbsWeight) maxAbsWeight = abs;
      }
    }
  }

  const effectiveDivisor =
    divisor > 0 ? divisor : Math.max(1, coins.length > 1 ? coins.length - 1 : 1);


return coins.map((base, i) =>
    coins.map((quote, j) => {
      if (i === j) {
        return {
          value: null,
          display: "-",
          background: "rgba(15,23,42,0.55)",
          polarity: "neutral",
          isDiagonal: true,
          textColor: "#94a3b8",
          tooltip: `${base}/${quote}`,
        } satisfies MatrixCell;
      }

      const weight = resolveNumeric(grid?.[base]?.[quote]);
      const mooValue = resolveNumeric(idPct?.[base]?.[quote]);
      const baseBalance = resolveNumeric(balances[base]);
      const baseUnit =
        baseBalance != null && Math.abs(baseBalance) > Number.EPSILON
          ? baseBalance / effectiveDivisor
          : null;
      const tierWeight =
        baseUnit != null && Math.abs(baseUnit) > Number.EPSILON && weight != null
          ? weight / baseUnit
          : null;
      const mooDisplay = formatDecimal(mooValue, 6, { signed: true });
      const tierDisplay = formatDecimal(tierWeight, 3);
      const allocDisplay = formatDecimal(weight, 4);
      const moodUuid = perSymbolMood?.[quote]?.[base]?.uuid ?? null;
      const detailParts: string[] = [];
      if (moodUuid) detailParts.push(moodUuid);
      detailParts.push(`w ${tierDisplay}`);
      const detail = detailParts.filter(Boolean).join(" · ");
      const tooltip = `${base}/${quote} | moo ${mooDisplay} | tier ${tierDisplay} | alloc ${allocDisplay}`;

      return {
        value: weight,
        display: mooDisplay,
        detail,
        detailColor: pickDetailColor(tierWeight),
        background: pickBackground(weight, maxAbsWeight),
        polarity:
          mooValue == null
            ? "neutral"
            : mooValue > 0
            ? "positive"
            : mooValue < 0
            ? "negative"
            : "neutral",
        textColor: pickPrimaryTextColor(mooValue),
        tooltip,
      } satisfies MatrixCell;
    })
  );
}

function resolveNumeric(value: unknown): number | null {
  if (value == null) return null;
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : null;
}

function pickBackground(weight: number | null, maxAbs: number): string {
  if (weight == null || Math.abs(weight) <= NULL_SENSITIVITY) {
    return withAlpha(COLOR_AMBER, 0.85);
  }
  if (maxAbs <= NULL_SENSITIVITY) {
    return withAlpha("#38bdf8", 0.22);
  }
  const ratio = Math.min(1, Math.abs(weight) / maxAbs);
  const eased = Math.pow(ratio, 0.65);
  const base = weight >= 0 ? "#38bdf8" : "#f97316";
  return withAlpha(base, 0.22 + 0.58 * eased);
}

function pickPrimaryTextColor(mooValue: number | null): string {
  if (mooValue == null) return "#d0d8e5";
  if (mooValue < 0) return "#f8fafc";
  if (mooValue > 0) return "#02131f";
  return "#e2e8f0";
}

function pickDetailColor(tierWeight: number | null): string {
  if (tierWeight == null) return "rgba(148,163,184,0.85)";
  if (tierWeight < 0) return "rgba(252,165,165,0.95)";
  if (tierWeight < 0.5) return "rgba(253,224,171,0.95)";
  if (tierWeight < 1) return "rgba(191,219,254,0.95)";
  if (tierWeight < 1.5) return "rgba(125,211,252,0.95)";
  return "rgba(96,165,250,0.95)";
}

function formatDecimal(
  value: number | null,
  digits: number,
  opts: { signed?: boolean } = {}
): string {
  if (value == null || !Number.isFinite(value)) return "-";
  const { signed = false } = opts;
  if (signed && Math.abs(value) < Number.EPSILON) return "0";
  const formatter = new Intl.NumberFormat(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: digits,
    signDisplay: signed ? "always" : "auto",
    useGrouping: true,
  });
  return formatter.format(value);
}






