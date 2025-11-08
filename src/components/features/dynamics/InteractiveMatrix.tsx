"use client";

import React, { useMemo } from "react";
import { DynamicsCard } from "./DynamicsCard";
import { classNames, formatNumber } from "./utils";

export type PreviewMap = Record<string, boolean | undefined>;
export type NumMap = Record<string, number | undefined>;

export type InteractiveMatrixProps = {
  coins: string[];
  meaValues: NumMap;
  idPctValues?: NumMap;
  previewAvailable?: PreviewMap;
  onSelect?: (base: string, quote: string, value: number | null) => void;
  className?: string;
  dimDiagonal?: boolean;
  decimals?: number;
  title?: string;
};

const key = (a: string, b: string) => `${a}-${b}`;

function ringCls(avail: boolean | undefined) {
  if (avail === true) return "ring-2 ring-emerald-400/80 ring-offset-2 ring-offset-emerald-400/10";
  if (avail === false) return "ring-2 ring-rose-400/80 ring-offset-2 ring-offset-rose-400/10";
  return "";
}

function amberFromIdPct(v?: number) {
  if (v == null || !Number.isFinite(v)) return "bg-slate-800/40";
  const a = Math.min(1, Math.abs(v) * 14);
  return `bg-amber-500/${Math.round(20 + a * 60)} text-slate-900`;
}

function fmtNum(n: number | null | undefined, decimals = 6) {
  if (n == null || !Number.isFinite(n)) return "-";
  return formatNumber(n, { precision: decimals, minimumFractionDigits: decimals });
}

export default function InteractiveMatrix({
  coins,
  meaValues,
  idPctValues,
  previewAvailable,
  onSelect,
  className = "",
  dimDiagonal = true,
  decimals = 6,
  title = "Interactive matrix",
}: InteractiveMatrixProps) {
  const rows = useMemo(() => coins.map((c) => c.toUpperCase()), [coins]);
  const cols = rows;

  return (
    <DynamicsCard title={title} subtitle="Click a cell to select" className={className}>
      <div className="overflow-auto rounded-xl border cp-border">
        <table className="min-w-max text-xs">
          <thead className="sticky top-0 z-10 bg-[#0f141a]">
            <tr>
              <th className="px-2 py-1 text-left text-slate-400">-</th>
              {cols.map((c) => (
                <th key={`h-${c}`} className="px-2 py-1 text-center text-slate-400">
                  {c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((rb) => (
              <tr key={`r-${rb}`}>
                <th className="sticky left-0 z-10 px-2 py-1 text-right text-slate-400 bg-[#0f141a]">{rb}</th>
                {cols.map((rq) => {
                  const diag = rb === rq;
                  const v = meaValues[key(rb, rq)];
                  const idp = idPctValues?.[key(rb, rq)];
                  const avail = previewAvailable?.[key(rb, rq)];
                  const baseBg = amberFromIdPct(idp);
                  const ring = ringCls(avail);
                  const disabled = diag && dimDiagonal;

                  return (
                    <td key={`c-${rb}-${rq}`} className="p-1">
                      <button
                        type="button"
                        className={classNames(
                          "flex h-8 min-w-[4.25rem] w-full items-center justify-center rounded-md border cp-border font-mono tabular-nums",
                          baseBg,
                          ring,
                          disabled ? "opacity-40 pointer-events-none" : "hover:brightness-[1.10]"
                        )}
                        title={`${rb}/${rq} = ${fmtNum(v, decimals)}`}
                        onClick={() => onSelect?.(rb, rq, v ?? null)}
                        aria-label={`${rb} to ${rq} value ${fmtNum(v, decimals)}`}
                      >
                        {fmtNum(v, decimals)}
                      </button>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-slate-400">
        <span>amber = |id_pct| intensity</span>
        <span className="rounded-md border px-2 py-[2px] ring-2 ring-emerald-400/80 ring-offset-2 ring-offset-emerald-400/10">preview ✓</span>
        <span className="rounded-md border px-2 py-[2px] ring-2 ring-rose-400/80 ring-offset-2 ring-offset-rose-400/10">preview ×</span>
        {dimDiagonal ? <span className="opacity-70">diagonal dimmed</span> : null}
      </div>
    </DynamicsCard>
  );
}
