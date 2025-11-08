"use client";

import React, { useMemo } from "react";
import { FROZEN_STAGE_COLORS, type FrozenStage } from "./colors";

export type Ring = "green" | "red" | "grey" | "purple";
export type Derivation = "direct" | "inverse" | "bridged";

export type Cell = {
  value: number | null;
  color: string;
  derivation?: Derivation;
  ring?: Ring;
};

type DualRow = { top: Cell; bottom: Cell };

export type ApiMatrixRow = {
  pair: string;
  base: string;
  quote: string;
  derivation: Derivation;
  ring: Ring;
  symbolRing: Ring;
  symbolFrozen: boolean;
  benchmark_pct24h: DualRow;
  ref_block: DualRow;
  delta: Cell;
  id_pct: Cell;
  pct_drv: Cell;
  meta?: { frozen?: boolean; frozenStage?: FrozenStage | null };
};

export type MetricKey =
  | "benchmark"
  | "pct24h"
  | "pct_ref"
  | "ref"
  | "id_pct"
  | "pct_drv"
  | "delta";

type MetricDescriptor = {
  key: MetricKey;
  title: string;
  subtitle: string;
  accent: string;
  accessor: (row: ApiMatrixRow) => Cell;
  formatter: (value: number | null) => string;
};

const METRICS: MetricDescriptor[] = [
  {
    key: "benchmark",
    title: "Benchmark Pulse",
    subtitle: "Live benchmark vs previous session",
    accent: "#38bdf8",
    accessor: (row) => row.benchmark_pct24h.top,
    formatter: (value) => formatNumber(value, 6),
  },
  {
    key: "pct24h",
    title: "24h Velocity",
    subtitle: "Rolling day-over-day change",
    accent: "#4ade80",
    accessor: (row) => row.benchmark_pct24h.bottom,
    formatter: (value) => formatPercent(value),
  },
  {
    key: "pct_ref",
    title: "Reference Drift",
    subtitle: "Benchmark vs opening anchor",
    accent: "#f97316",
    accessor: (row) => row.ref_block.top,
    formatter: (value) => formatPercent(value),
  },
  {
    key: "ref",
    title: "Reference Gain",
    subtitle: "Ref multiplier adjusted by id_pct",
    accent: "#22d3ee",
    accessor: (row) => row.ref_block.bottom,
    formatter: (value) => formatPercent(value),
  },
  {
    key: "id_pct",
    title: "Impulse Delta",
    subtitle: "Current benchmark vs previous",
    accent: "#a855f7",
    accessor: (row) => row.id_pct,
    formatter: (value) => formatPercent(value),
  },
  {
    key: "pct_drv",
    title: "Momentum Shift",
    subtitle: "Change in impulse delta",
    accent: "#fb7185",
    accessor: (row) => row.pct_drv,
    formatter: (value) => formatPercent(value),
  },
  {
    key: "delta",
    title: "Deviation Residual",
    subtitle: "Actual vs projected trajectory",
    accent: "#60a5fa",
    accessor: (row) => row.delta,
    formatter: (value) => formatNumber(value, 6),
  },
];

const RING_COLOR: Record<Ring, string> = {
  green: "#4ade80",
  red: "#f87171",
  grey: "#94a3b8",
  purple: "#c084fc",
};

const DERIVATION_LABEL: Record<Derivation, string> = {
  direct: "direct",
  inverse: "inverse",
  bridged: "bridged",
};

const DERIVATION_TONE: Record<Derivation, string> = {
  direct: "bg-emerald-500/20 text-emerald-200",
  inverse: "bg-rose-500/20 text-rose-200",
  bridged: "bg-slate-500/20 text-slate-200",
};

const FREEZE_TONE = "bg-purple-500/20 text-purple-200";

const VALUE_SHELL_BG = withAlpha("#020617", 0.35);

export default function Matrices({ rows, className = "" }: { rows: ApiMatrixRow[]; className?: string }) {
  const orderedRows = useMemo(() => {
    if (!rows.length) return [] as ApiMatrixRow[];
    return [...rows].sort((a, b) => a.base.localeCompare(b.base));
  }, [rows]);

  if (!orderedRows.length) {
    return (
      <section
        className={`rounded-2xl border border-white/10 bg-slate-950/80 px-6 py-10 text-center text-sm text-slate-300 shadow-[0_35px_120px_-40px_rgba(2,6,23,0.95)] ${className}`}
      >
        Matrix stream not available yet. Awaiting `/api/matrices/latest` …
      </section>
    );
  }

  return (
    <section className={`grid gap-4 lg:grid-cols-2 xl:grid-cols-4 ${className}`}>
      {METRICS.map((metric) => (
        <article
          key={metric.key}
          className="relative overflow-hidden rounded-2xl border border-white/12 bg-slate-950/80 p-5 shadow-[0_45px_90px_-40px_rgba(8,47,73,0.55)] backdrop-blur"
          style={{
            boxShadow:
              "0 0 0 1px rgba(148,163,184,0.12), 0 45px 110px -55px rgba(8,47,73,0.6)",
            backgroundImage: `linear-gradient(160deg, ${withAlpha(metric.accent, 0.16)}, rgba(2,6,23,0.94))`,
          }}
        >
          <header className="mb-4 space-y-1">
            <span
              className="rounded-full px-3 py-1 text-[11px] uppercase tracking-[0.32em] text-slate-200"
              style={{
                background: withAlpha(metric.accent, 0.15),
                color: metric.accent,
              }}
            >
              {metric.key}
            </span>
            <h3 className="text-xl font-semibold text-slate-50">{metric.title}</h3>
            <p className="text-[13px] text-slate-400">{metric.subtitle}</p>
          </header>

          <div className="space-y-2">
            {orderedRows.map((row) => {
              const cell = metric.accessor(row);
              const frozenStage = row.meta?.frozenStage ?? null;
              const ringAccent = frozenStage ? FROZEN_STAGE_COLORS[frozenStage] : RING_COLOR[row.symbolRing];
              const badgeTone = row.symbolFrozen ? FREEZE_TONE : DERIVATION_TONE[row.derivation];
              const badgeLabel = row.symbolFrozen
                ? frozenStage
                  ? `frozen ${frozenStage}`
                  : "frozen"
                : DERIVATION_LABEL[row.derivation];
              const badgeStyle = row.symbolFrozen
                ? {
                    background: withAlpha(ringAccent, 0.22),
                    color: ringAccent,
                    boxShadow: `0 0 12px ${withAlpha(ringAccent, 0.35)}`,
                  }
                : undefined;

              return (
                <div
                  key={`${metric.key}:${row.pair}`}
                  className="flex items-center gap-3 rounded-xl border border-white/7 bg-slate-950/50 px-3 py-2 text-[13px] text-slate-100"
                  style={{
                    boxShadow: `inset 0 1px 0 rgba(255,255,255,0.08), 0 0 0 1px ${withAlpha(
                      ringAccent,
                      0.22
                    )}`,
                    background: cell.color
                      ? `linear-gradient(135deg, ${withAlpha(cell.color, 0.75)}, rgba(2,6,23,0.82))`
                      : "rgba(2,6,23,0.85)",
                  }}
                >
                  <div className="flex min-w-[88px] flex-col">
                    <span className="font-mono text-[12px] leading-tight text-slate-200">{row.pair}</span>
                    <div className="mt-1 inline-flex items-center gap-1 text-[10px] uppercase tracking-wide text-slate-400">
                      <i
                        className="h-2 w-2 rounded-full"
                        style={{
                          background: ringAccent,
                          boxShadow: `0 0 8px ${withAlpha(ringAccent, 0.65)}`,
                        }}
                      />
                      {row.quote}
                    </div>
                  </div>

                  <div className="flex flex-1 items-center justify-end gap-2">
                    <div
                      className="inline-flex min-w-[96px] justify-end rounded-md px-3 py-1 font-mono text-[13px]"
                      style={{
                        background: VALUE_SHELL_BG,
                        color: valueTextColor(cell),
                        boxShadow: `inset 0 1px 0 rgba(255,255,255,0.14), 0 0 18px ${withAlpha(
                          cell.color,
                          0.5
                        )}`,
                      }}
                    >
                      {metric.formatter(cell.value)}
                    </div>

                    <span
                      className={`rounded-full px-2 py-0.5 text-[10px] font-medium uppercase ${badgeTone}`}
                      style={badgeStyle}
                    >
                      {badgeLabel}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </article>
      ))}
    </section>
  );
}

function formatPercent(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return `${(value * 100).toFixed(2)}%`;
}

function formatNumber(value: number | null, digits = 6): string {
  if (value == null || !Number.isFinite(value)) return "—";
  const s = value.toFixed(digits);
  return s.replace(/(\.\d*?[1-9])0+$/, "$1").replace(/\.$/, "");
}

function valueTextColor(cell: Cell): string {
  if (cell.value == null || !Number.isFinite(cell.value)) return "#e2e8f0";
  return cell.value >= 0 ? "#02131f" : "#f8fafc";
}

export function withAlpha(color: string, alpha: number): string {
  if (!color) return `rgba(15,23,42,${alpha})`;
  if (color.startsWith("rgba")) {
    return color.replace(/rgba\(([^)]+)\)/, (_match, inner) => {
      const parts = inner.split(",").map((part) => part.trim());
      const [r, g, b] = parts;
      return `rgba(${r}, ${g}, ${b}, ${alpha})`;
    });
  }
  if (color.startsWith("rgb")) {
    return color.replace(/rgb\(([^)]+)\)/, (_match, inner) => `rgba(${inner}, ${alpha})`);
  }
  if (!color.startsWith("#")) return color;

  const hex = color.slice(1);
  const normalized = hex.length === 3 ? hex.split("").map((h) => h + h).join("") : hex;
  const int = parseInt(normalized, 16);
  const r = (int >> 16) & 255;
  const g = (int >> 8) & 255;
  const b = int & 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
