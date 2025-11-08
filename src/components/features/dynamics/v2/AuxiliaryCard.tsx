"use client";

import React, { useEffect, useMemo, useState } from "react";
import { DynamicsCard } from "@/components/features/dynamics/DynamicsCard";
import { classNames, formatNumber, formatPercent } from "@/components/features/dynamics/utils";
import type { CinStat, DynamicsSnapshot } from "@/core/converters/provider.types";

type AuxMetrics = DynamicsSnapshot["metrics"];

export type AuxiliaryCardProps = {
  base: string;
  quote: string;
  metrics?: AuxMetrics | null;
  cin?: Record<string, CinStat> | null;
  candidates?: string[];
  coins?: string[];
  benchmarkGrid?: number[][] | undefined;
  lastUpdated?: number | string | Date | null;
  loading?: boolean;
  className?: string;
};

type StatBadgeProps = {
  label: string;
  value: React.ReactNode;
  hint?: React.ReactNode;
};

type StrMetricItemProps = {
  label: string;
  value: React.ReactNode;
  hint?: React.ReactNode;
};

type CinRow = { symbol: string; stat: CinStat };
type StrAuxSnapshot = {
  gfmDeltaPct: number | null;
  bfmDeltaPct: number | null;
  shifts: number | null;
  swaps: number | null;
  inertia: number | null;
  disruption: number | null;
  vTendency: number | null;
  vSwap: number | null;
};

type StrAuxState = {
  loading: boolean;
  error: string | null;
  metrics: StrAuxSnapshot | null;
};

const toNumber = (value: unknown): number | null => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
};

function toMillis(value: AuxiliaryCardProps["lastUpdated"]): number | null {
  if (value == null && value !== 0) return null;
  if (value instanceof Date) return Number.isFinite(value.getTime()) ? value.getTime() : null;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function formatRelative(value: AuxiliaryCardProps["lastUpdated"]) {
  const millis = toMillis(value);
  if (millis == null) return "n/a";
  const delta = Math.max(0, Date.now() - millis);
  const seconds = Math.floor(delta / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${seconds % 60}s ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours}h ${minutes % 60}m ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ${hours % 24}h ago`;
}

function StatBadge({ label, value, hint }: StatBadgeProps) {
  return (
    <div className="min-w-[96px] rounded-lg border border-emerald-500/25 bg-black/40 px-3 py-2 text-right text-[11px] text-emerald-200/80">
      <div className="text-[10px] uppercase tracking-[0.25em] text-emerald-300/70">{label}</div>
      <div className="mt-1 font-mono text-base leading-tight text-emerald-100">{value}</div>
      {hint ? <div className="mt-1 text-[10px] text-emerald-300/60">{hint}</div> : null}
    </div>
  );
}

function StrMetricItem({ label, value, hint }: StrMetricItemProps) {
  return (
    <div className="rounded-xl border border-emerald-500/25 bg-black/25 px-3 py-3 text-right">
      <div className="text-[10px] uppercase tracking-[0.3em] text-emerald-300/70">{label}</div>
      <div className="mt-1 font-mono text-[15px] leading-tight text-emerald-100">{value}</div>
      {hint ? <div className="mt-1 text-[10px] text-emerald-300/60">{hint}</div> : null}
    </div>
  );
}

const createEmptyCinStat = (): CinStat => ({
  session: { imprint: 0, luggage: 0 },
  cycle: { imprint: 0, luggage: 0 },
});

function deriveCinRows(
  cin: Record<string, CinStat> | null | undefined,
  base: string,
  quote: string
): CinRow[] {
  if (!cin) return [];
  const wanted = Array.from(
    new Set(
      [base, quote]
        .map((token) => String(token ?? "").toUpperCase())
        .filter(Boolean)
    )
  );
  if (!wanted.length) return [];

  const map = new Map<string, CinStat>();
  for (const [symbol, stat] of Object.entries(cin)) {
    const key = String(symbol ?? "").toUpperCase();
    if (!key) continue;
    map.set(key, stat);
  }

  const rows: CinRow[] = [];
  for (const symbol of wanted) {
    rows.push({ symbol, stat: map.get(symbol) ?? createEmptyCinStat() });
  }
  return rows;
}

function matrixValue(
  coins: string[] | undefined,
  grid: number[][] | undefined,
  base: string,
  quote: string
): number | null {
  if (!coins?.length || !grid?.length) return null;
  const i = coins.indexOf(base);
  const j = coins.indexOf(quote);
  if (i < 0 || j < 0) return null;
  const value = grid[i]?.[j];
  return Number.isFinite(value) ? (value as number) : null;
}

export default function AuxiliaryCard({
  base,
  quote,
  metrics,
  cin,
  candidates,
  coins,
  benchmarkGrid,
  lastUpdated,
  loading,
  className,
}: AuxiliaryCardProps) {
  const A = useMemo(() => String(base ?? "").toUpperCase(), [base]);
  const B = useMemo(() => String(quote ?? "").toUpperCase(), [quote]);
  const symbol = useMemo(() => (A && B ? `${A}${B}` : ""), [A, B]);

  const [strState, setStrState] = useState<StrAuxState>({ loading: false, error: null, metrics: null });

  const meaMetric = metrics?.mea ?? null;
  const strMetric = metrics?.str ?? null;
  const cinStats = cin ?? metrics?.cin ?? null;

  const candidateCount = Array.isArray(candidates)
    ? candidates.length
    : Object.keys(metrics?.cin ?? {}).length;
  const universeCount = coins?.length ?? 0;
  const openingValue = useMemo(() => matrixValue(coins, benchmarkGrid, A, B), [coins, benchmarkGrid, A, B]);
  const derivedCinRows = useMemo(() => deriveCinRows(cinStats, A, B), [cinStats, A, B]);

  useEffect(() => {
    if (!symbol) {
      setStrState({ loading: false, error: null, metrics: null });
      return;
    }
    if (typeof window === "undefined") return;

    const controller = new AbortController();
    setStrState((prev) => ({ ...prev, loading: true, error: null }));

    (async () => {
      try {
        const statsUrl = new URL("/api/str-aux/stats", window.location.origin);
        statsUrl.searchParams.set("symbols", symbol);
        statsUrl.searchParams.set("window", "30m");
        statsUrl.searchParams.set("bins", "128");

        const response = await fetch(statsUrl.toString(), { cache: "no-store", signal: controller.signal });
        if (!response.ok) throw new Error(`/api/str-aux/stats ${response.status}`);
        const payload = (await response.json()) as {
          ok: boolean;
          out?: Record<string, any>;
          error?: string;
        };
        if (!payload.ok) throw new Error(payload.error ?? "str-aux stats error");

        const entry = payload.out?.[symbol];
        if (!entry || entry.ok === false) {
          throw new Error(entry?.error ?? "str-aux metrics unavailable");
        }

        const stats = entry.stats ?? {};
        const vectors = stats.vectors ?? {};
        const swap = stats.vSwap ?? vectors.swap ?? null;
        const metrics: StrAuxSnapshot = {
          gfmDeltaPct: toNumber(entry.metrics?.gfm?.deltaPct ?? stats.deltaGfmPct),
          bfmDeltaPct: toNumber(entry.metrics?.bfm?.deltaPct ?? stats.deltaBfmPct),
          shifts: toNumber(entry.shifts?.nShifts ?? entry.shifts?.count),
          swaps: toNumber(swap?.Q),
          inertia: toNumber(
            entry.metrics?.intrinsic?.inertia?.total ??
              stats.inertia?.total ??
              entry.fm?.inertia
          ),
          disruption: toNumber(entry.metrics?.disruption ?? entry.fm?.disruption),
          vTendency: toNumber(
            stats.tendency?.score ??
              stats.tendency?.metrics?.score ??
              vectors.tendency?.metrics?.score
          ),
          vSwap: toNumber(swap?.score),
        };

        if (!controller.signal.aborted) {
          setStrState({ loading: false, error: null, metrics });
        }
      } catch (err: unknown) {
        if (controller.signal.aborted) return;
        setStrState({
          loading: false,
          error: err instanceof Error ? err.message : String(err),
          metrics: null,
        });
      }
    })();

    return () => controller.abort();
  }, [symbol]);

  const status =
    loading || strState.loading ? "Loading auxiliary data..." : `Snapshot - ${formatRelative(lastUpdated)}`;

  const formattedMea = meaMetric
    ? formatNumber(meaMetric.value, { precision: 4, fallback: "-" })
    : "-";

  const formattedTier = meaMetric?.tier ? meaMetric.tier : "n/a";
  const formattedGfm = strMetric ? formatNumber(strMetric.gfm, { precision: 4, fallback: "-" }) : "-";

  const strMetricsList = useMemo(() => {
    const data = strState.metrics;
    const fallbackShift = toNumber(strMetric?.shift);
    const fallbackTendency = toNumber(strMetric?.vTendency);

    return [
      {
        label: "GFM (delta)",
        value: formatPercent(data?.gfmDeltaPct, { precision: 2, fallback: "-" }),
        hint: "Delta vs reference (%)",
      },
      {
        label: "BFM (delta)",
        value: formatPercent(data?.bfmDeltaPct, { precision: 2, fallback: "-" }),
        hint: "Normalized delta (%)",
      },
      {
        label: "Shifts",
        value: formatNumber(data?.shifts ?? fallbackShift, { precision: 0, fallback: "-" }),
        hint: "Detected regime changes",
      },
      {
        label: "Swaps",
        value: formatNumber(data?.swaps, { precision: 2, fallback: "-" }),
        hint: "Quartile displacement (Q)",
      },
      {
        label: "Inertia",
        value: formatNumber(data?.inertia, { precision: 3, fallback: "-" }),
        hint: "Momentum inertia (Sigma)",
      },
      {
        label: "Disruption",
        value: formatNumber(data?.disruption, { precision: 3, fallback: "-" }),
        hint: "Histogram disruption",
      },
      {
        label: "vTendency",
        value: formatNumber(data?.vTendency ?? fallbackTendency, { precision: 3, fallback: "-" }),
        hint: "Directional tendency score",
      },
      {
        label: "vSwap",
        value: formatNumber(data?.vSwap, { precision: 3, fallback: "-" }),
        hint: "Swap vector score",
      },
    ];
  }, [strState.metrics, strMetric]);

  return (
    <DynamicsCard
      title="Auxiliary card"
      subtitle={`${A} -> ${B}`}
      status={status}
      className={classNames(
        "rounded-3xl border border-emerald-500/20 bg-[#03070f]/85 shadow-[0_0_28px_rgba(16,185,129,0.18)] backdrop-blur",
        className
      )}
      contentClassName="flex flex-col gap-6"
    >
      <div className="flex flex-col gap-4 rounded-2xl border border-emerald-500/25 bg-[#050b15]/90 p-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="text-[11px] uppercase tracking-[0.4em] text-emerald-300/70">MEA</div>
            <div className="mt-2 text-xs uppercase tracking-[0.35em] text-emerald-200/60">MEA-Value</div>
            <div className="mt-1 font-mono text-3xl leading-none text-emerald-100">{formattedMea}</div>
            <div className="mt-2 text-[11px] uppercase tracking-[0.25em] text-emerald-300/70">
              Tier - <span className="text-emerald-100">{formattedTier}</span>
            </div>
          </div>
          <div className="flex flex-wrap justify-end gap-3">
            <StatBadge label="Candidates" value={candidateCount} hint="Eligible STR pairs" />
            <StatBadge label="Universe" value={universeCount} hint="Coins in scope" />
            <StatBadge
              label="Opening"
              value={
                openingValue != null
                  ? formatNumber(openingValue, { precision: 4, fallback: "-" })
                  : "-"
              }
              hint="Benchmark snapshot"
            />
          </div>
        </div>

        <div className="h-px w-full bg-gradient-to-r from-transparent via-emerald-500/30 to-transparent" />

        <div className="rounded-2xl border border-emerald-500/35 bg-[#04101a]/80 p-4">
          <div className="mb-3 text-[11px] uppercase tracking-[0.35em] text-emerald-200">STR-Aux</div>
          {strState.error ? (
            <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 px-3 py-3 text-[11px] text-amber-200">
              {strState.error}
            </div>
          ) : strState.loading ? (
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              {Array.from({ length: 9 }).map((_, idx) => (
                <div
                  key={`str-skeleton-${idx}`}
                  className="h-16 rounded-xl border border-emerald-500/20 bg-emerald-500/10 animate-pulse"
                />
              ))}
            </div>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <StrMetricItem label="GFM" value={formattedGfm} hint="Absolute mode (price)" />
              {strMetricsList.map((item) => (
                <StrMetricItem key={item.label} label={item.label} value={item.value} hint={item.hint} />
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="rounded-2xl border border-emerald-500/25 bg-[#050b15]/85 p-4">
        <div className="mb-3 flex items-center justify-between">
          <div className="text-[11px] uppercase tracking-[0.35em] text-emerald-200">CIN-Aux</div>
          <div className="text-[10px] uppercase tracking-[0.2em] text-emerald-300/60">Session imprint · luggage</div>
        </div>
        {loading ? (
          <div className="space-y-2 text-[11px] text-emerald-200/50">
            <div className="h-9 w-full animate-pulse rounded-lg bg-emerald-500/10" />
            <div className="h-9 w-full animate-pulse rounded-lg bg-emerald-500/10" />
            <div className="h-9 w-full animate-pulse rounded-lg bg-emerald-500/10" />
          </div>
        ) : derivedCinRows.length ? (
          <div className="max-h-60 overflow-auto">
            <table className="min-w-full border-separate border-spacing-y-2 text-[11px]">
              <thead>
                <tr className="text-emerald-200/70">
                  <th className="w-24 text-left font-semibold uppercase tracking-[0.25em]">Coin</th>
                  <th className="px-3 text-right font-semibold uppercase tracking-[0.25em]">Imprint</th>
                  <th className="px-3 text-right font-semibold uppercase tracking-[0.25em]">Luggage</th>
                </tr>
              </thead>
              <tbody>
                {derivedCinRows.map(({ symbol, stat }) => (
                  <tr key={symbol} className="align-middle text-emerald-100">
                    <td className="rounded-l-xl bg-[#041017]/90 px-3 py-3 font-mono text-[12px] uppercase tracking-[0.25em] text-emerald-100">
                      {symbol}
                    </td>
                    <td className="bg-[#041017]/70 px-3 py-3 text-right">
                      <div className="font-mono text-[11px] tracking-normal text-emerald-100">
                        {formatNumber(stat.session.imprint, { precision: 3, fallback: "0" })}
                      </div>
                    </td>
                    <td className="rounded-r-xl bg-[#041017]/90 px-3 py-3 text-right">
                      <div className="font-mono text-[11px] tracking-normal text-emerald-100">
                        {formatNumber(stat.session.luggage, { precision: 3, fallback: "0" })}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="rounded-xl border border-emerald-500/20 bg-black/30 px-3 py-4 text-sm text-emerald-200/70">
            CIN auxiliary data unavailable for the current selection.
          </div>
        )}
      </div>
    </DynamicsCard>
  );
}
