// src/lib/format.ts
import type { CSSProperties } from "react";

export type HeatKind = "pct" | "abs";

export const fmt7 = (x: number | null | undefined) =>
  x == null || !Number.isFinite(x)
    ? "-"
    : (Math.abs(x) < 1e-12 ? 0 : x).toFixed(7);

export function formatForDisplay(value: number | null | undefined, kind: HeatKind) {
  if (value == null || !Number.isFinite(value)) return "-";
  if (kind === "pct") {
    const pct = value * 100;
    return `${(Math.abs(pct) < 1e-9 ? 0 : pct).toFixed(2)}%`;
  }
  return fmt7(value);
}

export function heat(
  value: number | null | undefined,
  opts: { kind: HeatKind; frozen?: boolean }
): CSSProperties {
  if (opts.frozen) return { backgroundColor: "rgba(147, 51, 234, 0.45)" };
  if (value == null || !Number.isFinite(value)) return { backgroundColor: "transparent" };

  const v = value;
  const nearZero = opts.kind === "pct" ? 1e-6 : 1e-9;
  if (Math.abs(v) < nearZero) return { backgroundColor: "rgba(217, 180, 85, 0.35)" };

  const denom = opts.kind === "pct" ? 0.05 : 0.02;
  const mag = Math.min(1, Math.abs(v) / denom);
  const alpha = 0.2 + 0.35 * mag;
  if (v >= 0) {
    return { backgroundColor: `rgba(16, 185, 129, ${alpha.toFixed(2)})` };
  }
  return { backgroundColor: `rgba(244, 63, 94, ${alpha.toFixed(2)})` };
}

export const tsLabel = (ts: number | null | undefined) => {
  if (!ts || !Number.isFinite(ts)) return "-";
  const d = new Date(Number(ts));
  return isNaN(d.getTime()) ? "-" : d.toLocaleString();
};

export const fmt5 = (x: number | null | undefined) =>
  x == null || !Number.isFinite(x) ? "-" : (Math.abs(Number(x)) < 1e-12 ? 0 : Number(x)).toFixed(5);

export const fmt6 = (x: number | null | undefined) =>
  x == null || !Number.isFinite(x) ? "-" : (Math.abs(Number(x)) < 1e-12 ? 0 : Number(x)).toFixed(6);

export const fmt0 = (x: number | null | undefined) =>
  x == null || !Number.isFinite(x) ? "-" : Math.round(Number(x)).toString();

export const fmtPct5 = (x: number | null | undefined) =>
  x == null || !Number.isFinite(x) ? "-" : `${(Number(x) * 100).toFixed(5)}%`;

export const fmt4 = (x: number | null | undefined) =>
  x == null || !Number.isFinite(Number(x)) ? "-" : Number(x).toFixed(4);

export const fmtPct2 = (x: number | null | undefined) =>
  x == null || !Number.isFinite(Number(x)) ? "-" : `${(Number(x) * 100).toFixed(2)}%`;
