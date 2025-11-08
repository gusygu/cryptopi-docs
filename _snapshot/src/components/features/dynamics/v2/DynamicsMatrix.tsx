"use client";

import React, { Fragment, useMemo } from "react";
import { DynamicsCard } from "@/components/features/dynamics/DynamicsCard";
import { classNames, formatNumber, uniqueUpper } from "@/components/features/dynamics/utils";
import {
  resolveCellPresentation,
  POSITIVE_SHADES,
  NEGATIVE_SHADES,
  type MatrixColorRules,
} from "@/app/matrices/colouring";
import { withAlpha } from "@/components/features/matrices/colors";

type MetricKind = "mea" | "ref";

type Grid = Array<Array<number | null>>;

export type DynamicsMatrixProps = {
  coins: string[];
  mea?: Grid;
  ref?: Grid;
  idPct?: Grid;
  frozenGrid?: boolean[][];
  allowedSymbols?: Set<string>;
  previewSet?: Set<string>;
  payloadSymbols?: string[];
  selected?: { base: string; quote: string } | null;
  lastUpdated?: number | string | Date | null;
  loading?: boolean;
  onSelect?: (payload: { base: string; quote: string; value: number | null; metric: MetricKind; assetId: string }) => void;
  className?: string;
};

const FREEZE_EPS = 1e-8;

const ensureUpper = (value: string | null | undefined): string =>
  String(value ?? "").trim().toUpperCase();

const MEA_THRESHOLDS: readonly number[] = [0.0025, 0.005, 0.01, 0.02, 0.04];
const REF_THRESHOLDS: readonly number[] = [0.003, 0.006, 0.012, 0.024, 0.048];

const MEA_COLOR_RULES: MatrixColorRules = {
  key: "mea",
  thresholds: MEA_THRESHOLDS,
  positivePalette: POSITIVE_SHADES,
  negativePalette: NEGATIVE_SHADES,
  zeroFloor: 0.0008,
  derive: (value) => (value == null ? null : value - 1),
  ringStrategy: "preview",
};

const REF_COLOR_RULES: MatrixColorRules = {
  key: "ref",
  thresholds: REF_THRESHOLDS,
  positivePalette: POSITIVE_SHADES,
  negativePalette: NEGATIVE_SHADES,
  zeroFloor: 0.0004,
  derive: (value) => value,
  ringStrategy: "preview",
};

function safeValue(grid: Grid | undefined, i: number, j: number): number | null {
  const v = grid?.[i]?.[j];
  if (v == null || !Number.isFinite(v)) return null;
  return v;
}

function formatRelative(ts?: number | string | Date | null): string {
  if (ts == null && ts !== 0) return "n/a";
  const millis =
    ts instanceof Date
      ? ts.getTime()
      : typeof ts === "string"
      ? Number.isFinite(Date.parse(ts))
        ? Date.parse(ts)
        : NaN
      : ts;
  if (!Number.isFinite(millis)) return "n/a";
  const delta = Math.max(0, Date.now() - Number(millis));
  const secs = Math.floor(delta / 1_000);
  if (secs < 60) return `${secs}s ago`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ${secs % 60}s ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 48) return `${hours}h ${mins % 60}m ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ${hours % 24}h ago`;
}

export default function DynamicsMatrix(props: DynamicsMatrixProps) {
  const {
    coins,
    mea,
    ref,
    idPct,
    frozenGrid,
    allowedSymbols,
    previewSet,
    payloadSymbols,
    selected,
    lastUpdated,
    loading,
    onSelect,
    className,
  } = props;
  const rows = useMemo(() => uniqueUpper(coins ?? []), [coins]);
  const cols = rows;
  const selectedBase = selected?.base ? String(selected.base).toUpperCase() : null;
  const selectedQuote = selected?.quote ? String(selected.quote).toUpperCase() : null;

  const status = loading ? "Loading matrix..." : `Snapshot | ${formatRelative(lastUpdated ?? null)}`;

  const previewSymbols = useMemo(() => previewSet ?? new Set<string>(), [previewSet]);
  const payloadSymbolSet = useMemo(() => {
    if (!payloadSymbols?.length) return undefined;
    const set = new Set<string>();
    for (const sym of payloadSymbols) {
      set.add(ensureUpper(sym));
    }
    return set;
  }, [payloadSymbols]);
  const symbolSets = useMemo(
    () => ({ preview: previewSymbols, payload: payloadSymbolSet }),
    [previewSymbols, payloadSymbolSet]
  );

  const renderCell = (rowIdx: number, colIdx: number, metric: MetricKind) => {
    const base = rows[rowIdx]!;
    const quote = cols[colIdx]!;
    const isDiagonal = base === quote;
    const directSymbol = `${base}${quote}`;
    const inverseSymbol = `${quote}${base}`;
    const pairAllowed = allowedSymbols?.size
      ? allowedSymbols.has(directSymbol) || allowedSymbols.has(inverseSymbol)
      : true;

    if (isDiagonal) {
      return (
        <td key={`${metric}-${base}-${quote}`} className="p-1">
          <div className="pointer-events-none flex h-14 w-full items-center justify-center rounded-lg border border-slate-700/50 bg-[rgba(15,23,42,0.55)] px-2 text-right font-mono text-[11px] text-slate-400">
            -
          </div>
        </td>
      );
    }

    const rawValue = metric === "mea" ? safeValue(mea, rowIdx, colIdx) : safeValue(ref, rowIdx, colIdx);
    const idValue = safeValue(idPct, rowIdx, colIdx);
    const frozen =
      Boolean(frozenGrid?.[rowIdx]?.[colIdx]) ||
      (idValue != null && Math.abs(idValue) <= FREEZE_EPS);

    const rules = metric === "mea" ? MEA_COLOR_RULES : REF_COLOR_RULES;
    const presentation = resolveCellPresentation({
      rules,
      value: rawValue,
      frozen,
      directSymbol,
      inverseSymbol,
      symbolSets,
    });

    const isSelected = selectedBase === base && selectedQuote === quote;
    const displayNumber = rawValue ?? (metric === "mea" ? 1 : 0);
    const formattedValue = formatNumber(displayNumber, {
      precision: 6,
      minimumFractionDigits: 4,
      fallback: "0.0000",
    });
    const display = isDiagonal ? "—" : formattedValue;

    let background = presentation.background;
    let textColor =
      presentation.textColor ??
      (presentation.polarity === "negative" ? "#fef2f2" : presentation.polarity === "positive" ? "#022c22" : "#e2e8f0");
    let ringColor = presentation.ringColor;

    if (!pairAllowed) {
      ringColor = "rgba(148,163,184,0.65)";
    }
    if (isDiagonal) {
      background = "rgba(15,23,42,0.55)";
      textColor = "#94a3b8";
      ringColor = null;
    }

    const boxShadows = ["inset 0 1px 0 rgba(255,255,255,0.08)"];
    if (ringColor) {
      boxShadows.push(`0 0 0 1px ${withAlpha(ringColor, 0.9)}`);
      boxShadows.push(`0 0 0 4px ${withAlpha(ringColor, 0.25)}`);
    }
    if (isSelected) {
      boxShadows.push("0 0 0 2px rgba(59,130,246,0.45)");
    }

    const label = metric === "mea" ? "MEA" : "REF";
    const tooltipBase =
      rawValue != null
        ? `${label} ${base}/${quote} = ${rawValue.toFixed(6)}`
        : `${label} ${base}/${quote} unavailable`;
    const tooltip = frozen
      ? `${tooltipBase} (frozen)`
      : !pairAllowed
      ? `${tooltipBase} (pair unavailable)`
      : tooltipBase;

    return (
      <td key={`${metric}-${base}-${quote}`} className="p-1">
        <button
          type="button"
          className={classNames(
            "relative flex h-12 w-full items-center justify-end rounded-lg border px-1.5 py-1 text-right font-mono text-[11px] tabular-nums transition",
            "hover:brightness-110"
          )}
          style={{
            background,
            color: textColor,
            borderColor: ringColor ?? "rgba(71,85,105,0.45)",
            boxShadow: boxShadows.join(", "),
            outline: "none",
          }}
          title={tooltip}
          onClick={() => {
            onSelect?.({
              base,
              quote,
              value: rawValue,
              metric,
              assetId: `${base}/${quote}`,
            });
          }}
        >
          <span className="relative block leading-tight">{display}</span>
        </button>
      </td>
    );
  };

  return (
    <DynamicsCard
      title="Dynamics matrix"
      subtitle="MEA vs REF grid"
      status={status}
      className={classNames(
        "rounded-3xl border border-emerald-500/25 bg-[#050810]/90 shadow-[0_0_32px_rgba(16,185,129,0.18)] backdrop-blur",
        className
      )}
      contentClassName="flex flex-col gap-3"
    >
      <div className="flex flex-wrap items-center gap-3 text-[11px] text-emerald-200/80">
        <span className="rounded-full border border-emerald-500/40 bg-emerald-500/10 px-2 py-[2px]">MEA row</span>
        <span className="rounded-full border border-cyan-500/40 bg-cyan-500/10 px-2 py-[2px]">REF row</span>
        <span className="rounded-full border border-emerald-400/40 px-2 py-[2px] text-emerald-200/80">
          Click a cell to focus the pair
        </span>
      </div>

      <div className="flex-1 overflow-auto rounded-2xl border border-emerald-500/15 bg-black/40">
        {rows.length === 0 || cols.length === 0 ? (
          <div className="px-4 py-8 text-sm text-emerald-200/70">Matrix data unavailable.</div>
        ) : (
          <table className="min-w-full border-separate border-spacing-0 text-[11px]">
            <thead className="sticky top-0 z-10 bg-[#060a12]/95 text-emerald-200/70 backdrop-blur">
              <tr>
                <th className="w-24 px-3 py-2 text-left font-semibold uppercase tracking-[0.25em] text-emerald-300/70">
                  base
                </th>
                <th className="w-16 px-3 py-2 text-left font-semibold uppercase tracking-[0.2em] text-emerald-300/60">
                  metric
                </th>
                {cols.map((coin) => (
                  <th
                    key={`head-${coin}`}
                    className="px-2 py-2 text-right font-mono uppercase tracking-[0.18em] text-emerald-300/70"
                  >
                    {coin}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((base, rowIdx) => (
                <Fragment key={base}>
                  <tr>
                    <th
                      rowSpan={2}
                      scope="rowgroup"
                      className="bg-[#060a12]/80 px-3 py-2 text-left font-semibold uppercase tracking-[0.25em] text-emerald-100"
                    >
                      {base}
                    </th>
                    <th
                      scope="row"
                      className="bg-[#060a12]/70 px-3 py-2 text-left font-semibold uppercase tracking-[0.2em] text-emerald-200"
                    >
                      MEA
                    </th>
                    {cols.map((_, colIdx) => renderCell(rowIdx, colIdx, "mea"))}
                  </tr>
                  <tr>
                    <th
                      scope="row"
                      className="bg-[#041017]/70 px-3 py-2 text-left font-semibold uppercase tracking-[0.2em] text-cyan-200"
                    >
                      REF
                    </th>
                    {cols.map((_, colIdx) => renderCell(rowIdx, colIdx, "ref"))}
                  </tr>
                </Fragment>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </DynamicsCard>
  );
}
