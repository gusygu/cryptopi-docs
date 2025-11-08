"use client";

import React, { useMemo } from "react";
import { DynamicsCard } from "@/components/features/dynamics/DynamicsCard";
import { classNames, formatNumber, formatPercent } from "@/components/features/dynamics/utils";

export type ArbTableRow = {
  symbol: string;
  spread?: number;
  benchmark?: number;
  velocity?: number;
  direction?: "up" | "down" | "frozen";
  inertia?: "low" | "neutral" | "high" | "frozen";
  wallet?: number;
  updatedAt?: number | string | Date | null;
};

export type ArbTableProps = {
  base: string;
  quote: string;
  rows: ArbTableRow[];
  loading?: boolean;
  refreshing?: boolean;
  onSelectRow?: (symbol: string) => void;
  onRefresh?: () => void;
  className?: string;
  rowsLimit?: number;
};

const INERTIA_LABEL: Record<NonNullable<ArbTableRow["inertia"]>, string> = {
  low: "Low",
  neutral: "Neutral",
  high: "High",
  frozen: "Frozen",
};

const INERTIA_CLASS: Record<NonNullable<ArbTableRow["inertia"]>, string> = {
  low: "text-emerald-300",
  neutral: "text-slate-300",
  high: "text-amber-300",
  frozen: "text-slate-500",
};

const DIRECTION_LABEL: Record<NonNullable<ArbTableRow["direction"]>, string> = {
  up: "Bull",
  down: "Bear",
  frozen: "Flat",
};

const DIRECTION_CLASS: Record<NonNullable<ArbTableRow["direction"]>, string> = {
  up: "border-emerald-500/50 bg-emerald-500/10 text-emerald-200",
  down: "border-rose-500/50 bg-rose-500/10 text-rose-200",
  frozen: "border-slate-500/40 bg-slate-500/10 text-slate-200",
};

function parseTimestamp(value: ArbTableRow["updatedAt"]): number | null {
  if (!value && value !== 0) return null;
  if (value instanceof Date) return value.getTime();
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

function StatusBadge({
  direction,
  inertia,
}: {
  direction?: ArbTableRow["direction"];
  inertia?: ArbTableRow["inertia"];
}) {
  if (!direction && !inertia) return null;
  const dirLabel = direction ? DIRECTION_LABEL[direction] : null;
  const dirClass = direction ? DIRECTION_CLASS[direction] : "border-slate-600/40 bg-slate-600/10 text-slate-200";
  return (
    <div className="flex flex-wrap items-center gap-2">
      {dirLabel ? (
        <span className={classNames("rounded-full border px-2 py-0.5 text-[11px] uppercase tracking-wide", dirClass)}>
          {dirLabel}
        </span>
      ) : null}
      {inertia ? (
        <span className={classNames("text-xs uppercase tracking-[0.25em]", INERTIA_CLASS[inertia])}>
          {INERTIA_LABEL[inertia]}
        </span>
      ) : null}
    </div>
  );
}

function EmptyState({ loading }: { loading?: boolean }) {
  return (
    <div className="flex h-32 items-center justify-center rounded-2xl border border-dashed border-emerald-500/20 text-sm text-slate-400">
      {loading ? "Loading arbitrage candidates…" : "No arbitrage candidates detected."}
    </div>
  );
}

function LoadingSkeleton() {
  return (
    <div className="grid gap-3">
      {Array.from({ length: 4 }).map((_, idx) => (
        <div
          key={idx}
          className="h-12 animate-pulse rounded-2xl bg-gradient-to-r from-emerald-500/10 via-emerald-500/20 to-emerald-500/10"
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
  onRefresh,
  onSelectRow,
  className,
  rowsLimit = 6,
}: ArbTableProps) {
  const A = useMemo(() => String(base ?? "").toUpperCase(), [base]);
  const B = useMemo(() => String(quote ?? "").toUpperCase(), [quote]);

  const prepared = useMemo(() => {
    const trimmed = rowsLimit > 0 ? rows.slice(0, rowsLimit) : rows;
    return trimmed.map((row) => ({
      ...row,
      symbol: String(row.symbol ?? "").toUpperCase(),
    }));
  }, [rows, rowsLimit]);

  const statusLabel = refreshing ? "Refreshing…" : loading ? "Loading…" : `${prepared.length} candidates`;
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

  return (
    <DynamicsCard
      title="Arbitrage table"
      subtitle={`${A} ↔ ${B}`}
      status={statusLabel}
      actions={headerActions}
      className={classNames(
        "rounded-3xl border border-emerald-500/20 bg-[#05080d]/85 shadow-[0_0_24px_rgba(16,185,129,0.2)] backdrop-blur",
        className
      )}
      contentClassName="flex flex-col gap-4"
    >
      {loading && !prepared.length ? (
        <LoadingSkeleton />
      ) : prepared.length ? (
        <div className="overflow-hidden rounded-2xl border border-emerald-500/20">
          <table className="w-full border-collapse text-sm text-emerald-50">
            <thead className="bg-black/40 text-[11px] uppercase tracking-[0.3em] text-emerald-300/70">
              <tr>
                <th className="px-4 py-3 text-left">Symbol</th>
                <th className="px-4 py-3 text-right">Spread</th>
                <th className="px-4 py-3 text-right">Benchmark</th>
                <th className="px-4 py-3 text-right">Velocity</th>
                <th className="px-4 py-3 text-right">Wallet</th>
                <th className="px-4 py-3 text-left">Status</th>
                <th className="px-4 py-3 text-right">Updated</th>
              </tr>
            </thead>
            <tbody>
              {prepared.map((row) => (
                <tr
                  key={row.symbol}
                  className="border-t border-emerald-500/10 bg-black/20 text-sm transition hover:bg-emerald-500/10"
                  onClick={() => onSelectRow?.(row.symbol)}
                >
                  <td className="px-4 py-3 font-mono uppercase tracking-[0.25em] text-emerald-200">{row.symbol}</td>
                  <td className="px-4 py-3 text-right font-mono tabular-nums text-emerald-100">
                    {formatPercent(row.spread, { fallback: "—", precision: 4, sign: "always" })}
                  </td>
                  <td className="px-4 py-3 text-right font-mono tabular-nums text-slate-200">
                    {formatPercent(row.benchmark, { fallback: "—", precision: 3 })}
                  </td>
                  <td className="px-4 py-3 text-right font-mono tabular-nums text-slate-200">
                    {formatPercent(row.velocity, { fallback: "—", precision: 3, sign: "always" })}
                  </td>
                  <td className="px-4 py-3 text-right font-mono tabular-nums text-emerald-200">
                    {formatNumber(row.wallet, { fallback: "—", precision: 2 })}
                  </td>
                  <td className="px-4 py-3">
                    <StatusBadge direction={row.direction} inertia={row.inertia} />
                  </td>
                  <td className="px-4 py-3 text-right text-xs text-slate-400">{relativeLabel(row.updatedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <EmptyState loading={loading || refreshing} />
      )}
    </DynamicsCard>
  );
}
