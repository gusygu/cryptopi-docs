"use client";

import React, { useMemo } from "react";
import type { HistogramSnapshot } from "@/core/converters/provider.types";
import { DynamicsCard } from "./DynamicsCard";
import { classNames, formatNumber, formatPercent } from "./utils";

export type AssetsIdentityProps = {
  base: string;
  quote: string;
  coins: string[];
  matrix: {
    benchmark?: number[][];
    id_pct?: number[][];
    pct24h?: number[][];
  };
  wallets: Record<string, number>;
  histogram?: HistogramSnapshot;
  series?: { pct_drv?: number[] };
  refreshing?: boolean;
  className?: string;
};

export default function AssetsIdentity({
  base,
  quote,
  coins,
  matrix,
  wallets,
  histogram,
  series,
  refreshing = false,
  className,
}: AssetsIdentityProps) {
  const baseU = base.toUpperCase();
  const quoteU = quote.toUpperCase();
  const coinsUpper = useMemo(() => coins.map((c) => c.toUpperCase()), [coins.join("|")]);

  const benchAB = matrixCell(matrix.benchmark, coinsUpper, baseU, quoteU);
  const idAB = matrixCell(matrix.id_pct, coinsUpper, baseU, quoteU);
  const pctAB = matrixCell(matrix.pct24h, coinsUpper, baseU, quoteU);

  const benchAU = matrixCell(matrix.benchmark, coinsUpper, baseU, "USDT");
  const idAU = matrixCell(matrix.id_pct, coinsUpper, baseU, "USDT");

  const benchQU = matrixCell(matrix.benchmark, coinsUpper, quoteU, "USDT");
  const idQU = matrixCell(matrix.id_pct, coinsUpper, quoteU, "USDT");

  const histData = useMemo(() => {
    if (histogram && histogram.counts.length) return histogram.counts;
    const src = series?.pct_drv ?? [];
    if (!src.length) return [];
    const clean = src.filter((n) => Number.isFinite(n));
    if (!clean.length) return [];
    const min = Math.min(...clean);
    const max = Math.max(...clean);
    if (min === max) return [clean.length];
    const bins = Math.min(64, Math.max(16, Math.ceil(clean.length / 2)));
    const step = (max - min) / bins || 1;
    const counts = Array.from({ length: bins }, () => 0);
    for (const v of clean) {
      const idx = Math.min(bins - 1, Math.floor((v - min) / step));
      counts[idx] += 1;
    }
    return counts;
  }, [histogram, series?.pct_drv]);

  const walletBase = wallets[baseU] ?? 0;
  const walletQuote = wallets[quoteU] ?? 0;
  const walletUsdt = wallets["USDT"] ?? 0;

  return (
    <DynamicsCard
      title="Pair summary"
      subtitle={`${baseU}/${quoteU}`}
      status={refreshing ? "Refreshing..." : undefined}
      className={className}
    >
      <div className="grid gap-3 text-xs">
        <div className="flex flex-wrap gap-2">
          <span className="cp-pill-emerald">Base {baseU}</span>
          <span className="cp-pill-emerald">Quote {quoteU}</span>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <BadgeKV label="bench" value={benchAB} fmt="bench" />
          <BadgeKV label="id_pct" value={idAB} fmt="id" />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <BadgeKV label="bench (base→USDT)" value={benchAU} fmt="bench" />
          <BadgeKV label="bench (quote→USDT)" value={benchQU} fmt="bench" />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <BadgeKV label="id_pct (base→USDT)" value={idAU} fmt="id" />
          <BadgeKV label="id_pct (quote→USDT)" value={idQU} fmt="id" />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <WalletCard coin={baseU} balance={walletBase} />
          <WalletCard coin={quoteU} balance={walletQuote} />
        </div>
        <WalletCard coin="USDT" balance={walletUsdt} />
        <div>
          <div className="mb-1 text-[11px] text-slate-400">24h pct</div>
          <BadgeKV label="pct24h" value={pctAB} fmt="pct" neutral />
        </div>
        <Histogram counts={histData} />
      </div>
    </DynamicsCard>
  );
}

function matrixCell(
  grid: number[][] | undefined,
  coins: string[],
  base: string,
  quote: string
): number | null {
  if (!grid || !coins.length) return null;
  const i = coins.indexOf(base);
  const j = coins.indexOf(quote);
  if (i < 0 || j < 0) return null;
  const v = grid[i]?.[j];
  return Number.isFinite(Number(v)) ? Number(v) : null;
}

function BadgeKV({
  label,
  value,
  fmt,
  neutral = false,
}: {
  label: string;
  value: number | null;
  fmt: "bench" | "id" | "pct";
  neutral?: boolean;
}) {
  const numeric = Number(value);
  const bad = !Number.isFinite(numeric);
  const text =
    bad && fmt !== "pct"
      ? "-"
      : fmt === "bench"
      ? formatNumber(numeric, { precision: 4 })
      : fmt === "id"
      ? formatNumber(numeric, { precision: 6 })
      : formatPercent(numeric, { precision: 4 });

  const tone = neutral
    ? "bg-slate-800/50 text-slate-200 border-slate-700/60"
    : numeric >= 0
    ? "bg-emerald-900/35 text-emerald-200 border-emerald-800/50"
    : "bg-rose-900/45 text-rose-200 border-rose-800/60";

  return (
    <div className="rounded-md border px-3 py-2 shadow-inner">
      <div className="mb-0.5 text-[11px] text-slate-400">{label}</div>
      <div className={classNames("inline-flex min-w-[88px] items-center justify-center rounded-lg border px-2 py-1 font-mono text-[11px] tabular-nums", tone)}>
        {text}
      </div>
    </div>
  );
}

function WalletCard({ coin, balance }: { coin: string; balance?: number }) {
  const numeric = Number(balance);
  const has = Number.isFinite(numeric) && numeric !== 0;
  return (
    <div
      className={classNames(
        "rounded-md border px-3 py-2",
        has ? "border-emerald-800/50 bg-emerald-950/20 text-emerald-200" : "border-slate-800 bg-slate-900/50 text-slate-300"
      )}
      title={has ? `${coin}  -  ${formatNumber(numeric, { precision: 6 })}` : "No balance"}
    >
      <div className="text-[11px] text-slate-400">{coin}</div>
      <div className="font-mono tabular-nums text-sm">
        {Number.isFinite(numeric) ? formatNumber(numeric, { precision: 6, minimumFractionDigits: 0 }) : "-"}
      </div>
    </div>
  );
}

function Histogram({ counts }: { counts: number[] }) {
  if (!counts.length) {
    return (
      <div className="flex h-[88px] items-center justify-center rounded-md border cp-border bg-black/20 text-sm text-slate-400">
        No histogram data.
      </div>
    );
  }

  const width = 320;
  const height = 72;
  const pad = 6;
  const total = counts.length;
  const max = counts.reduce((m, v) => (v > m ? v : m), 0);
  const bandwidth = (width - pad * 2) / total;
  const scaleY = (v: number) => Math.round((height - pad * 2) * (v / max || 0));

  return (
    <div className="overflow-hidden">
      <svg viewBox={`0 0 ${width} ${height}`} className="h-[88px] w-full rounded-md border cp-border bg-black/20">
        {counts.map((v, i) => {
          const h = scaleY(v);
          const x = pad + i * bandwidth;
          const y = height - pad - h;
          return (
            <rect
              key={i}
              x={x}
              y={y}
              width={Math.max(1, bandwidth - 1)}
              height={Math.max(1, h)}
              rx={2}
              className="fill-emerald-600/60"
            />
          );
        })}
      </svg>
    </div>
  );
}
