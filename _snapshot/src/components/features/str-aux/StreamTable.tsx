"use client";

import React from "react";

import type { StreamsSnapshot, ShiftStamp } from "./types";

type StreamsTableProps = {
  streams?: StreamsSnapshot;
  accent?: "emerald" | "cyan" | "violet";
};

const accentClass: Record<string, string> = {
  emerald: "text-emerald-200",
  cyan: "text-cyan-200",
  violet: "text-violet-200",
};

const deltaClass: Record<string, string> = {
  pos: "text-emerald-200",
  neg: "text-rose-200",
  flat: "text-zinc-300",
};

const timeFmt = new Intl.DateTimeFormat(undefined, {
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

function formatStampTime(ts?: number) {
  if (!ts || !Number.isFinite(ts)) return "-";
  return timeFmt.format(new Date(ts));
}

function formatNumber(n?: number, opts?: { digits?: number; signed?: boolean }) {
  if (!Number.isFinite(n as number)) return "-";
  const { digits = 4, signed = false } = opts ?? {};
  const value = n as number;
  const fixed = Math.abs(value) >= 1 ? value.toFixed(digits > 3 ? 3 : digits) : value.toPrecision(digits);
  if (!signed) return fixed;
  return value > 0 ? `+${fixed}` : fixed;
}

function rowDeltaClass(delta: number) {
  if (!Number.isFinite(delta)) return deltaClass.flat;
  if (delta > 0) return deltaClass.pos;
  if (delta < 0) return deltaClass.neg;
  return deltaClass.flat;
}

export default function StreamsTable({ streams, accent = "emerald" }: StreamsTableProps) {
  const stamps: ShiftStamp[] = streams?.stamps ?? [];
  const highlight = accentClass[accent] ?? accentClass.emerald;

  return (
    <div className="rounded-2xl border border-white/10 bg-[#0b1220]/90 overflow-hidden">
      <div className="flex items-center justify-between px-3 py-2 text-[11px] uppercase tracking-wide text-white/60 border-b border-white/10">
        <span>streams</span>
        {streams?.lastShiftTs && (
          <span className={["font-mono", highlight].join(" ")}>last {formatStampTime(streams.lastShiftTs)}</span>
        )}
      </div>
      {stamps.length ? (
        <table className="w-full text-xs">
          <thead className="text-[11px] uppercase tracking-wide text-white/50">
            <tr>
              <th className="px-3 py-2 text-left font-normal">time</th>
              <th className="px-3 py-2 text-right font-normal">price</th>
              <th className="px-3 py-2 text-right font-normal">gfm</th>
              <th className="px-3 py-2 text-right font-normal">Δgfm%</th>
            </tr>
          </thead>
          <tbody>
            {stamps.slice().reverse().map((stamp, idx) => (
              <tr key={`${stamp.ts}-${idx}`} className="border-t border-white/5">
                <td className="px-3 py-2 text-left font-mono text-[12px] text-white/80">{formatStampTime(stamp.ts)}</td>
                <td className="px-3 py-2 text-right font-mono text-[12px] text-white/80">
                  {formatNumber(stamp.price, { digits: 6 })}
                </td>
                <td className="px-3 py-2 text-right font-mono text-[12px] text-white/80">
                  {formatNumber(stamp.gfm, { digits: 4 })}
                </td>
                <td className={`px-3 py-2 text-right font-mono text-[12px] ${rowDeltaClass(stamp.deltaPct)}`}>
                  {formatNumber(stamp.deltaPct, { digits: 4, signed: true })}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <div className="px-3 py-6 text-center text-xs text-white/50">No shift stamps yet.</div>
      )}
    </div>
  );
}
