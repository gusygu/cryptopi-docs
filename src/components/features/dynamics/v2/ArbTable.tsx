"use client";

import React, { useMemo, useState } from "react";
import { DynamicsCard } from "@/components/features/dynamics/DynamicsCard";
import { classNames, formatNumber, formatPercent } from "@/components/features/dynamics/utils";
import type { SwapTag } from "@/core/converters/provider.types";

export type ArbEdgeKey = "cb_ci" | "ci_ca" | "ca_ci";

export type ArbEdgeMetrics = {
  idPct: number | null;
  benchmark: number | null;
  vTendency: number | null;
  moo?: number | null;
  ref?: number | null;
  swapTag?: SwapTag;
};

export type ArbTableRow = {
  symbol: string;
  spread?: number | null;
  benchmark?: number | null;
  velocity?: number | null;
  direction?: "up" | "down" | "frozen";
  inertia?: "low" | "neutral" | "high" | "frozen";
  wallet?: number;
  updatedAt?: number | string | Date | null;
  edges: Record<ArbEdgeKey, ArbEdgeMetrics>;
  vSwap?: number | null;
};

export type ArbTableProps = {
  base: string;
  quote: string;
  rows: ArbTableRow[];
  loading?: boolean;
  refreshing?: boolean;
  rowsLimit?: number;
  onSelectRow?: (symbol: string) => void;
  onRefresh?: () => void;
  className?: string;
};

const EDGE_INFO: Record<ArbEdgeKey, { id: ArbEdgeKey; hint: string }> = {
  cb_ci: { id: "cb_ci", hint: "Quote leg → candidate" },
  ci_ca: { id: "ci_ca", hint: "Candidate → base" },
  ca_ci: { id: "ca_ci", hint: "Base → candidate (hedge)" },
};

const DIRECTION_LABEL: Record<NonNullable<ArbTableRow["direction"]>, string> = {
  up: "Bias up",
  down: "Bias down",
  frozen: "Flat",
};

const DIRECTION_TONE: Record<NonNullable<ArbTableRow["direction"]>, string> = {
  up: "border-sky-400/60 bg-sky-500/10 text-sky-200",
  down: "border-orange-400/60 bg-orange-500/10 text-orange-200",
  frozen: "border-slate-500/40 bg-slate-600/10 text-slate-200",
};

const INERTIA_LABEL: Record<NonNullable<ArbTableRow["inertia"]>, string> = {
  low: "Low inertia",
  neutral: "Neutral inertia",
  high: "High inertia",
  frozen: "Frozen inertia",
};

const SORT_DEFAULT = { key: "spread", dir: "desc" } as const;
type SortKey = "spread" | "symbol";
type SortDir = "asc" | "desc";

function parseTimestamp(value: ArbTableRow["updatedAt"]): number | null {
  if (!value && value !== 0) return null;
  if (value instanceof Date) return Number.isFinite(value.getTime()) ? value.getTime() : null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function relativeLabel(value: ArbTableRow["updatedAt"]) {
  const millis = parseTimestamp(value);
  if (millis == null) return "n/a";
  const delta = Math.max(0, Date.now() - millis);
  const seconds = Math.floor(delta / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${seconds % 60}s ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ${minutes % 60}m ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function SwapBadge({ tag }: { tag?: SwapTag }) {
  if (!tag) {
    return <span className="text-[11px] text-slate-500">no swaps</span>;
  }
  const tone =
    tag.direction === "up"
      ? "border-sky-400/60 bg-sky-500/10 text-sky-100"
      : tag.direction === "down"
      ? "border-orange-400/60 bg-orange-500/10 text-orange-100"
      : "border-slate-500/40 bg-slate-600/10 text-slate-200";
  const label = tag.direction === "up" ? "UP" : tag.direction === "down" ? "DOWN" : "FLAT";
  const timeLabel = tag.changedAtIso ? relativeLabel(tag.changedAtIso) : "n/a";
  return (
    <div className={classNames("flex flex-col rounded-xl border px-2.5 py-1 text-[10px] uppercase tracking-[0.25em]", tone)}>
      <div className="flex items-center justify-between gap-2">
        <span>{label}</span>
        <span className="font-mono text-[11px] tracking-normal">
          {formatNumber(tag.count, { precision: 0, fallback: "0" })}
        </span>
      </div>
      <div className="mt-0.5 text-[9px] lowercase tracking-normal text-slate-200/80">last {timeLabel}</div>
    </div>
  );
}

function EdgeCell({
  label,
  metrics,
}: {
  label: string;
  metrics?: ArbEdgeMetrics;
}) {
  const idValue = formatPercent(metrics?.idPct, { fallback: "-", precision: 4, sign: "always" });
  const bmValue = formatNumber(metrics?.benchmark, { fallback: "-", precision: 4 });
  const vtValue = formatNumber(metrics?.vTendency, { fallback: "-", precision: 3, sign: "always" });
  const mooValue = formatNumber(metrics?.moo, { fallback: "-", precision: 4 });
  const refValue = formatNumber(metrics?.ref, { fallback: "-", precision: 5 });

  return (
    <div className="rounded-2xl border border-emerald-500/20 bg-[#03070f]/70 p-3 transition hover:border-emerald-400/40 hover:bg-emerald-500/5">
      <div className="flex items-center justify-between text-[11px] uppercase tracking-[0.25em] text-emerald-300/70">
        <span>{label}</span>
        <SwapBadge tag={metrics?.swapTag} />
      </div>
      <div className="mt-2 grid grid-cols-2 gap-1 text-[11px] text-emerald-200/80">
        <span className="font-mono text-sm text-emerald-100">{idValue}</span>
        <span className="text-right">bm {bmValue}</span>
        <span>MOO {mooValue}</span>
        <span className="text-right">REF {refValue}</span>
      </div>
      <div className="mt-1 text-[11px] text-emerald-200/70">vt {vtValue}</div>
    </div>
  );
}

function StatusChips({
  direction,
  inertia,
  vSwap,
}: {
  direction?: ArbTableRow["direction"];
  inertia?: ArbTableRow["inertia"];
  vSwap?: number | null;
}) {
  if (!direction && !inertia && vSwap == null) return null;
  return (
    <div className="mt-2 flex flex-wrap gap-2 text-[11px] uppercase tracking-wide">
      {direction ? (
        <span className={classNames("rounded-full border px-2 py-0.5", DIRECTION_TONE[direction])}>
          {DIRECTION_LABEL[direction]}
        </span>
      ) : null}
      {inertia ? <span className="text-slate-300">{INERTIA_LABEL[inertia]}</span> : null}
      {vSwap != null ? (
        <span className="rounded-full border border-emerald-400/40 bg-emerald-400/10 px-2 py-0.5 font-mono tracking-normal text-emerald-100">
          vSwap {formatNumber(vSwap, { precision: 3, fallback: "-" })}
        </span>
      ) : null}
    </div>
  );
}

function SortButton({
  label,
  active,
  direction,
  onClick,
}: {
  label: string;
  active: boolean;
  direction: SortDir;
  onClick(): void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={classNames(
        "inline-flex items-center gap-1 text-[11px] uppercase tracking-[0.25em]",
        active ? "text-emerald-200" : "text-emerald-200/70 hover:text-emerald-100"
      )}
    >
      {label}
      <svg
        aria-hidden="true"
        viewBox="0 0 16 16"
        className={classNames("h-3.5 w-3.5 transition-transform", direction === "asc" && active ? "rotate-180" : "rotate-0")}
      >
        <path d="M4 6L8 2l4 4M12 10l-4 4-4-4" stroke="currentColor" strokeWidth="1.6" fill="none" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </button>
  );
}

function EmptyState({ loading }: { loading?: boolean }) {
  return (
    <div className="flex h-32 items-center justify-center rounded-2xl border border-dashed border-emerald-400/25 text-sm text-emerald-200/70">
      {loading ? "Loading arbitrage candidates..." : "No arbitrage candidates detected."}
    </div>
  );
}

function LoadingSkeleton() {
  return (
    <div className="grid gap-3">
      {Array.from({ length: 4 }).map((_, idx) => (
        <div
          key={`arb-skeleton-${idx}`}
          className="h-16 animate-pulse rounded-2xl bg-gradient-to-r from-emerald-500/10 via-emerald-500/20 to-emerald-500/10"
        />
      ))}
    </div>
  );
}

export default function ArbTable({
  base,
  quote,
  rows,
  loading,
  refreshing,
  rowsLimit = 6,
  onSelectRow,
  onRefresh,
  className,
}: ArbTableProps) {
  const A = useMemo(() => String(base ?? "").toUpperCase(), [base]);
  const B = useMemo(() => String(quote ?? "").toUpperCase(), [quote]);
  const [sort, setSort] = useState<{ key: SortKey; dir: SortDir }>(SORT_DEFAULT);

  const edgeLabels = useMemo(
    () => ({
      cb_ci: `${B} → Ci`,
      ci_ca: `Ci → ${A}`,
      ca_ci: `${A} → Ci`,
    }),
    [A, B]
  );

  const prepared = useMemo(() => {
    return rows
      .map((row) => ({
        ...row,
        symbol: String(row.symbol ?? "").toUpperCase(),
      }))
      .filter((row) => row.symbol.length > 0);
  }, [rows]);

  const sorted = useMemo(() => {
    const next = [...prepared];
    next.sort((a, b) => {
      if (sort.key === "symbol") {
        return sort.dir === "asc" ? a.symbol.localeCompare(b.symbol) : b.symbol.localeCompare(a.symbol);
      }
      const av = Number(a.spread ?? Number.NEGATIVE_INFINITY);
      const bv = Number(b.spread ?? Number.NEGATIVE_INFINITY);
      const safeA = Number.isFinite(av) ? av : Number.NEGATIVE_INFINITY;
      const safeB = Number.isFinite(bv) ? bv : Number.NEGATIVE_INFINITY;
      return sort.dir === "asc" ? safeA - safeB : safeB - safeA;
    });
    return rowsLimit > 0 ? next.slice(0, rowsLimit) : next;
  }, [prepared, sort, rowsLimit]);

  const statusLabel = refreshing ? "Refreshing..." : loading ? "Loading arbitrage..." : `${sorted.length} candidates`;
  const headerActions = onRefresh ? (
    <button
      type="button"
      className="btn btn-silver text-xs disabled:opacity-60"
      onClick={onRefresh}
      disabled={refreshing || loading}
    >
      Refresh
    </button>
  ) : undefined;

  const handleSort = (key: SortKey) => {
    setSort((prev) =>
      prev.key === key ? { key, dir: prev.dir === "asc" ? "desc" : "asc" } : { key, dir: key === "symbol" ? "asc" : "desc" }
    );
  };

  return (
    <DynamicsCard
      title="Arbitrage table"
      subtitle={`${A} · ${B}`}
      status={statusLabel}
      actions={headerActions}
      className={classNames(
        "rounded-3xl border border-emerald-500/25 bg-[#04070d]/90 shadow-[0_0_32px_rgba(16,185,129,0.15)] backdrop-blur",
        className
      )}
      contentClassName="flex flex-col gap-4"
    >
      {loading && !prepared.length ? (
        <LoadingSkeleton />
      ) : !sorted.length ? (
        <EmptyState loading={loading || refreshing} />
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-emerald-500/20">
          <table className="w-full min-w-[780px] border-collapse text-sm text-emerald-50">
            <thead className="bg-[#03060c]/80 text-[11px] uppercase tracking-[0.35em] text-emerald-200/80">
              <tr>
                <th className="px-4 py-3 text-left">
                  <SortButton label="Ci" active={sort.key === "symbol"} direction={sort.dir} onClick={() => handleSort("symbol")} />
                </th>
                {Object.keys(EDGE_INFO).map((key) => (
                  <th key={key} className="px-3 py-3 text-left">
                    {edgeLabels[key as ArbEdgeKey]}
                  </th>
                ))}
                <th className="px-3 py-3 text-right">
                  <SortButton label="Spread" active={sort.key === "spread"} direction={sort.dir} onClick={() => handleSort("spread")} />
                </th>
                <th className="px-3 py-3 text-right">Updated</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((row) => (
                <tr
                  key={row.symbol}
                  className="border-t border-emerald-500/10 bg-black/10 align-top transition hover:bg-emerald-500/10"
                  onClick={() => onSelectRow?.(row.symbol)}
                >
                  <td className="px-4 py-4">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="font-mono text-base uppercase tracking-[0.2em] text-emerald-100">{row.symbol}</span>
                      {row.wallet != null ? (
                        <span className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-[2px] text-[11px] text-emerald-200">
                          {formatNumber(row.wallet, { fallback: "-", precision: 2 })}
                        </span>
                      ) : null}
                    </div>
                    <StatusChips direction={row.direction} inertia={row.inertia} vSwap={row.vSwap} />
                  </td>
                  {Object.keys(EDGE_INFO).map((key) => (
                    <td key={`${row.symbol}-${key}`} className="px-3 py-3">
                      <EdgeCell label={edgeLabels[key as ArbEdgeKey]} metrics={row.edges?.[key as ArbEdgeKey]} />
                    </td>
                  ))}
                  <td className="px-3 py-4 text-right font-mono text-sm text-emerald-100">
                    {formatPercent(row.spread, { fallback: "-", precision: 4, sign: "always" })}
                  </td>
                  <td className="px-3 py-4 text-right text-xs text-emerald-200/70">{relativeLabel(row.updatedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </DynamicsCard>
  );
}
