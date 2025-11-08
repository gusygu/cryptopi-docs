"use client";

import React, { useEffect, useMemo, useState } from "react";
import type { Coins, Grid } from "@/lib/dynamics.contracts";
import { DynamicsCard } from "./DynamicsCard";
import { classNames, formatNumber, uniqueUpper } from "./utils";

type Props = {
  coins: Coins;
  grid?: Grid;
  base?: string;
  quote?: string;
  onSelect?: (base: string, quote: string) => void;
  onRefresh?: () => void;
  refreshing?: boolean;
  className?: string;
  title?: string;
  previewPairs?: string[];
};

export default function DynamicsMatrix({
  coins: coinsProp,
  grid,
  base,
  quote,
  onSelect,
  onRefresh,
  refreshing = false,
  className = "",
  title = "Dynamics - MEA matrix",
  previewPairs = [],
}: Props) {
  const coins: Coins = useMemo(
    () => uniqueUpper((coinsProp && coinsProp.length ? coinsProp : []).map((c) => c.toUpperCase())),
    [coinsProp?.join("|")]
  );

  const [sel, setSel] = useState<{ b: string; q: string }>(() => {
    const b = (base || coins[0] || "BTC").toUpperCase();
    const q = (quote || coins.find((c) => c !== b) || "USDT").toUpperCase();
    return { b, q };
  });

  useEffect(() => {
    const b = (base || sel.b || coins[0] || "BTC").toUpperCase();
    let q = (quote || sel.q || coins.find((c) => c !== b) || "USDT").toUpperCase();
    if (b === q) {
      const alt = coins.find((c) => c !== b);
      if (alt) q = alt;
    }
    setSel((old) => (old.b === b && old.q === q ? old : { b, q }));
  }, [base, quote, coins.join("|")]);

  const previewSet = useMemo(
    () => new Set(previewPairs.map((p) => String(p).toUpperCase())),
    [previewPairs.join("|")]
  );

  const clickCell = (b: string, q: string) => {
    if (b === q) return;
    setSel({ b, q });
    onSelect?.(b, q);
  };

  const statusText = refreshing ? "Refreshing..." : undefined;
  const actions = onRefresh ? (
    <button className="btn btn-silver btn-xs" onClick={onRefresh} type="button" disabled={refreshing}>
      Refresh
    </button>
  ) : null;

  return (
    <DynamicsCard
      title={title}
      subtitle={`Selected ${sel.b}/${sel.q}`}
      status={statusText}
      actions={actions}
      className={className}
    >
      <div className="flex h-full flex-col gap-3">
        <Legend />
        <div className="flex-1 overflow-auto rounded-xl border border-slate-800/60 bg-slate-900/60 p-3">
          {!grid || !coins.length ? (
            <div className="py-6 text-sm text-slate-400">No matrix data.</div>
          ) : (
            <table className="min-w-[720px] text-[11px]">
              <thead className="sticky top-0 bg-slate-900/90 backdrop-blur">
                <tr>
                  <th className="w-12" />
                  {coins.map((c) => (
                    <th key={`h-${c}`} className="px-1.5 py-1 text-right font-mono tabular-nums text-slate-400">
                      {c}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {coins.map((b, i) => (
                  <tr key={`row-${b}`}>
                    <td className="px-1.5 py-1 text-left font-semibold text-slate-300">{b}</td>
                    {coins.map((q, j) => {
                      const v = grid?.[i]?.[j];
                      const ab = previewSet.has(`${b}${q}`);
                      const ba = previewSet.has(`${q}${b}`);
                      const isSel = sel.b === b && sel.q === q;
                      const ring = ringCls({ isSel, ab, ba });

                      return (
                        <td key={`cell-${b}-${q}`} className="px-0.5 py-0.5">
                          {b === q ? (
                            <div className="rounded-md border border-slate-800/50 bg-slate-900/40 px-2 py-1 text-center text-slate-500">
                              -
                            </div>
                          ) : (
                            <button
                              type="button"
                              onClick={() => clickCell(b, q)}
                              className={classNames(
                                "w-full rounded-md border px-2 py-1 text-right font-mono tabular-nums transition",
                                colorCls(v),
                                ring
                              )}
                              title={`${b}/${q}`}
                            >
                              {formatNumber(v, { precision: 6 })}
                            </button>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </DynamicsCard>
  );
}

function Legend() {
  return (
    <div className="flex flex-wrap items-center gap-2 text-[11px] text-slate-400">
      <Chip color="amber">amber: neutral (0.000000)</Chip>
      <Chip color="emerald">green: &gt; 0 (8 shades)</Chip>
      <Chip color="rose">red: &lt; 0 (8 shades)</Chip>
      <Ring color="emerald">preview A/B</Ring>
      <Ring color="rose">preview B/A only</Ring>
      <Ring color="slate">bridged</Ring>
      <Ring color="blue">selected</Ring>
    </div>
  );
}

function Chip({ color, children }: { color: "amber" | "emerald" | "rose"; children: React.ReactNode }) {
  const map = {
    amber: "border-amber-700/60 bg-amber-950/30 text-amber-200 ring-1 ring-amber-800/40",
    emerald: "border-emerald-700/60 bg-emerald-950/30 text-emerald-200 ring-1 ring-emerald-800/40",
    rose: "border-rose-700/60 bg-rose-950/30 text-rose-200 ring-1 ring-rose-800/40",
  } as const;
  return <span className={classNames("inline-flex items-center rounded-lg px-2 py-0.5 border", map[color])}>{children}</span>;
}

function Ring({ color, children }: { color: "emerald" | "rose" | "slate" | "blue"; children: React.ReactNode }) {
  const map = {
    emerald: "ring-1 ring-emerald-500/70",
    rose: "ring-1 ring-rose-500/70",
    slate: "ring-1 ring-slate-400/60",
    blue: "ring-2 ring-sky-400/80",
  } as const;
  return (
    <span
      className={classNames(
        "inline-flex items-center rounded-lg px-2 py-0.5 border border-slate-700/60 bg-slate-900/40",
        map[color]
      )}
    >
      {children}
    </span>
  );
}

function colorCls(v: number | null) {
  if (v == null || !Number.isFinite(Number(v))) {
    return "border-slate-800/40 bg-slate-900/40 text-slate-500";
  }
  if (v === 0) {
    return "border-amber-700/40 bg-amber-900/30 text-amber-200";
  }
  const n = Number(v);
  const m = Math.abs(n);
  const idx =
    m < 0.00025 ? 0 :
    m < 0.0005 ? 1 :
    m < 0.001 ? 2 :
    m < 0.002 ? 3 :
    m < 0.004 ? 4 :
    m < 0.008 ? 5 :
    m < 0.016 ? 6 : 7;

  const POS = [
    "border-emerald-800/20 bg-emerald-900/15 text-emerald-200",
    "border-emerald-800/25 bg-emerald-900/20 text-emerald-200",
    "border-emerald-800/35 bg-emerald-900/30 text-emerald-200",
    "border-emerald-800/45 bg-emerald-900/40 text-emerald-100",
    "border-emerald-800/60 bg-emerald-900/50 text-emerald-100",
    "border-emerald-800/70 bg-emerald-900/60 text-emerald-100",
    "border-emerald-800/80 bg-emerald-900/70 text-emerald-50",
    "border-emerald-800/90 bg-emerald-900/80 text-emerald-50",
  ];
  const NEG = [
    "border-rose-900/25 bg-rose-950/20 text-rose-200",
    "border-rose-900/35 bg-rose-950/28 text-rose-200",
    "border-rose-800/45 bg-rose-900/40 text-rose-200",
    "border-rose-800/55 bg-rose-900/50 text-rose-100",
    "border-rose-800/70 bg-rose-900/60 text-rose-100",
    "border-rose-800/80 bg-rose-900/70 text-rose-100",
    "border-rose-800/88 bg-rose-900/78 text-rose-50",
    "border-rose-800/95 bg-rose-900/88 text-rose-50",
  ];

  return n > 0 ? POS[idx] : NEG[idx];
}

function ringCls({ isSel, ab, ba }: { isSel: boolean; ab: boolean; ba: boolean }) {
  const base = ab
    ? "ring-1 ring-emerald-500/70"
    : !ab && ba
    ? "ring-1 ring-rose-500/70"
    : "ring-1 ring-slate-400/60";
  const sel = isSel ? "ring-2 ring-sky-400/80 shadow-[0_0_0_1px_rgba(56,189,248,0.3)]" : "";
  return classNames(base, sel);
}
