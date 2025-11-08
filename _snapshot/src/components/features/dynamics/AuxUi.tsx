"use client";

import React, { useEffect, useMemo, useState } from "react";
import { useSettings } from "@/lib/settings/provider";
import { DynamicsCard } from "./DynamicsCard";
import { classNames, formatNumber, formatPercent, uniqueUpper } from "./utils";
import type { Coins, Grid } from "@/lib/dynamics.contracts";

type Props = {
  coins?: Coins;
  base?: string;
  quote?: string;
  onSelectPair?: (base: string, quote: string) => void;
  grid?: Grid;
  strMetrics?: { gfm?: number; shift?: number; vTendency?: number };
  previewPairs?: string[];
  refreshing?: boolean;
  className?: string;
};

export default function AuxUi({
  coins: coinsProp,
  base,
  quote,
  onSelectPair,
  grid,
  strMetrics,
  previewPairs = [],
  refreshing = false,
  className,
}: Props) {
  const { settings } = useSettings() as any;
  const universe = useMemo(
    () => uniqueUpper((coinsProp && coinsProp.length ? coinsProp : []).map((c) => c.toUpperCase())),
    [coinsProp?.join("|")]
  );

  const clusters = (settings?.clustering?.clusters ?? [{ id: "default", name: "Cluster 1", coins: [] }]) as Array<{
    id: string;
    name: string;
    coins: string[];
  }>;

  const [applyClustering] = useState<boolean>(true);
  const [clusterIdx, setClusterIdx] = useState<number>(0);

  const coinsForAux: Coins = useMemo(() => {
    const clusterCoins = (clusters?.[clusterIdx]?.coins ?? []).map((c) => c.toUpperCase());
    const filtered =
      applyClustering && clusterCoins.length >= 2
        ? clusterCoins.filter((c) => universe.includes(c))
        : universe;
    return uniqueUpper(filtered);
  }, [universe.join("|"), applyClustering, clusterIdx, JSON.stringify(clusters)]);

  useEffect(() => {
    if (clusterIdx >= clusters.length) setClusterIdx(0);
  }, [clusterIdx, clusters.length]);

  const [selected, setSelected] = useState<{ base: string; quote: string }>(() => {
    const b = (base || coinsForAux[0] || "BTC").toUpperCase();
    const q = (quote || coinsForAux.find((c) => c !== b) || "USDT").toUpperCase();
    return { base: b, quote: q };
  });

  useEffect(() => {
    const b = (base || selected.base || coinsForAux[0] || "BTC").toUpperCase();
    let q = (quote || selected.quote || coinsForAux.find((c) => c !== b) || "USDT").toUpperCase();
    if (b === q) {
      const alt = coinsForAux.find((c) => c !== b);
      if (alt) q = alt;
    }
    setSelected((prev) => (prev.base === b && prev.quote === q ? prev : { base: b, quote: q }));
  }, [base, quote, coinsForAux.join("|")]);

  const setPair = (b: string, q: string) => {
    const B = b.toUpperCase();
    const Q = q.toUpperCase();
    if (B === Q) return;
    setSelected({ base: B, quote: Q });
    onSelectPair?.(B, Q);
  };

  const statusText = refreshing ? "Refreshing..." : undefined;
  const previewSet = useMemo(
    () => new Set((previewPairs ?? []).map((p) => String(p).toUpperCase())),
    [previewPairs?.join("|")]
  );

  return (
    <DynamicsCard title="Auxiliaries" subtitle={`${selected.base} / ${selected.quote}`} status={statusText} className={className}>
      <div className="flex h-full flex-col gap-4">
        <section className="grid gap-2 md:grid-cols-3">
          <label className="grid gap-1 text-xs text-slate-300">
            <span>Cluster</span>
            <select
              className="rounded-md border cp-border bg-[#0f141a] px-2 py-1 text-sm"
              value={String(clusterIdx)}
              onChange={(e) => setClusterIdx(Number(e.target.value) || 0)}
            >
              {clusters.map((c, i) => (
                <option key={c.id || i} value={i}>
                  {c.name} ({c.coins.length})
                </option>
              ))}
            </select>
          </label>

          <label className="grid gap-1 text-xs text-slate-300">
            <span>Base</span>
            <select
              className="rounded-md border cp-border bg-[#0f141a] px-2 py-1 text-sm"
              value={selected.base}
              onChange={(e) => setPair(e.target.value, selected.quote)}
            >
              {coinsForAux.map((c) => (
                <option key={`b-${c}`} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </label>

          <label className="grid gap-1 text-xs text-slate-300">
            <span>Quote</span>
            <select
              className="rounded-md border cp-border bg-[#0f141a] px-2 py-1 text-sm"
              value={selected.quote}
              onChange={(e) => setPair(selected.base, e.target.value)}
            >
              {coinsForAux.map((c) => (
                <option key={`q-${c}`} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </label>
        </section>

        <section className="grid gap-2 md:grid-cols-3">
          <MetricBadge
            label="GFM Δ"
            value={strMetrics?.gfm ?? 0}
            precision={4}
            suffix=""
            goodHigh
          />
          <MetricBadge
            label="Shift"
            value={strMetrics?.shift ?? 0}
            precision={4}
            suffix=""
            neutral
          />
          <MetricBadge
            label="vTendency"
            value={strMetrics?.vTendency ?? 0}
            precision={4}
            suffix=""
            goodHigh
          />
        </section>

        {grid && grid.length ? (
          <MatrixPreview
            grid={grid}
            coins={coinsForAux}
            selected={selected}
            onSelect={setPair}
            previewSet={previewSet}
          />
        ) : (
          <div className="rounded-lg border cp-border bg-slate-900/60 p-4 text-sm text-slate-400">
            No MEA matrix data.
          </div>
        )}
      </div>
    </DynamicsCard>
  );
}

function MetricBadge({
  label,
  value,
  precision,
  suffix,
  goodHigh,
  neutral,
}: {
  label: string;
  value?: number | null;
  precision: number;
  suffix?: string;
  goodHigh?: boolean;
  neutral?: boolean;
}) {
  const numeric = Number(value);
  const bad = !Number.isFinite(numeric);
  const text = bad
    ? "-"
    : suffix === "%"
    ? formatPercent(numeric, { precision })
    : formatNumber(numeric, { precision, minimumFractionDigits: 0 });

  const pos = "bg-emerald-900/35 text-emerald-200 border-emerald-800/50";
  const neg = "bg-rose-900/45 text-rose-200 border-rose-800/60";
  const neu = "bg-slate-800/50 text-slate-200 border-slate-700/60";

  let cls = neu;
  if (!bad && !neutral) {
    cls = goodHigh ? (numeric >= 0 ? pos : neg) : numeric <= 0 ? pos : neg;
  }

  return (
    <div className="rounded-xl border px-3 py-2 shadow-inner">
      <div className="mb-0.5 text-[11px] text-slate-400">{label}</div>
      <div className={classNames("inline-flex min-w-[88px] items-center justify-center rounded-lg border px-2 py-1 font-mono text-[11px] tabular-nums", cls)}>
        {text}
      </div>
    </div>
  );
}

function MatrixPreview({
  grid,
  coins,
  selected,
  onSelect,
  previewSet,
}: {
  grid: Grid;
  coins: Coins;
  selected: { base: string; quote: string };
  onSelect?: (base: string, quote: string) => void;
  previewSet: Set<string>;
}) {
  const rows = coins.length;
  const cols = coins.length;

  const formatCell = (value: unknown) =>
    Number.isFinite(Number(value)) ? formatNumber(value, { precision: 4 }) : "-";

  const handleSelect = (base: string, quote: string) => {
    if (!onSelect || base === quote) return;
    onSelect(base, quote);
  };

  return (
    <section className="rounded-lg border cp-border p-3">
      <div className="mb-2 text-xs text-slate-300">MEA matrix glimpse</div>
      <div className="overflow-x-auto text-[11px]">
        <table className="min-w-full border-collapse">
          <thead>
            <tr>
              <th className="px-2 py-1"></th>
              {coins.map((coin) => (
                <th key={`h-${coin}`} className="px-2 py-1 text-right font-semibold text-slate-300">
                  {coin}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: rows }).map((_, i) => {
              const base = coins[i];
              return (
                <tr key={`r-${base}`}>
                  <td className="px-2 py-1 text-left font-semibold text-slate-300">{base}</td>
                  {Array.from({ length: cols }).map((__, j) => {
                    const quote = coins[j];
                    const value = grid?.[i]?.[j];
                    const active = base === selected.base && quote === selected.quote;
                    const preview = previewSet.has(`${base}${quote}`);

                    if (base === quote) {
                      return (
                        <td key={`c-${i}-${j}`} className="px-2 py-1 text-right text-slate-500">
                          <div className="rounded-md border border-slate-800/60 bg-slate-900/40 px-2 py-1 text-center">-</div>
                        </td>
                      );
                    }

                    return (
                      <td key={`c-${i}-${j}`} className="px-1 py-1">
                        <button
                          type="button"
                          onClick={() => handleSelect(base, quote)}
                          className={classNames(
                            "w-full rounded-md border px-2 py-1 text-right font-mono tabular-nums transition",
                            active
                              ? "border-emerald-600/60 bg-emerald-950/40 text-emerald-100 ring-1 ring-emerald-500/40"
                              : preview
                              ? "border-emerald-600/40 bg-emerald-950/30 text-emerald-100"
                              : "border-slate-700/60 bg-slate-900/60 text-slate-200 hover:border-emerald-500/50 hover:text-emerald-100"
                          )}
                          title={`${base}/${quote}`}
                        >
                          {formatCell(value)}
                        </button>
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
