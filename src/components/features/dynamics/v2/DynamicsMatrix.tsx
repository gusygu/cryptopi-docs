"use client";

import React, { useMemo } from "react";
import { DynamicsCard } from "@/components/features/dynamics/DynamicsCard";
import { classNames, formatNumber, formatPercent, uniqueUpper } from "@/components/features/dynamics/utils";
import {
  resolveCellPresentation,
  POSITIVE_SHADES,
  NEGATIVE_SHADES,
  MOO_POSITIVE_SHADES,
  MOO_NEGATIVE_SHADES,
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
const NULL_BACKGROUND = "rgba(250,204,21,0.24)";
const NULL_TEXT = "#422006";

const ensureUpper = (value: string | null | undefined): string => String(value ?? "").trim().toUpperCase();

const MEA_THRESHOLDS: readonly number[] = [0.0025, 0.005, 0.01, 0.02, 0.04];
const REF_THRESHOLDS: readonly number[] = [0.003, 0.006, 0.012, 0.024, 0.048];

const MEA_COLOR_RULES: MatrixColorRules = {
  key: "mea",
  thresholds: MEA_THRESHOLDS,
  positivePalette: MOO_POSITIVE_SHADES,
  negativePalette: MOO_NEGATIVE_SHADES,
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

type MetricButtonProps = {
  metric: MetricKind;
  value: number | null;
  presentation: ReturnType<typeof resolveCellPresentation>;
  disabled: boolean;
  idPercent?: number | null;
  onClick(): void;
};

function MetricButton({ metric, value, presentation, disabled, idPercent, onClick }: MetricButtonProps) {
  const hasValue = value != null && Number.isFinite(value);
  const precision = metric === "mea" ? 6 : 7;
  const formatted = formatNumber(value, {
    fallback: metric === "mea" ? "no moo" : "no ref",
    precision,
    minimumFractionDigits: metric === "mea" ? undefined : 7,
  });
  const background = hasValue ? presentation.background : NULL_BACKGROUND;
  const ringColor = presentation.ringColor ?? "rgba(148,163,184,0.35)";
  const textColor = hasValue
    ? presentation.textColor ??
      (presentation.polarity === "negative"
        ? "#fde8e8"
        : presentation.polarity === "positive"
        ? "#022c22"
        : "#e2e8f0")
    : NULL_TEXT;

  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={classNames(
        "flex w-full items-center justify-between gap-3 rounded-full border px-3 py-1.5 text-left transition",
        disabled ? "cursor-not-allowed opacity-45" : "hover:-translate-y-0.5 hover:shadow-[0_8px_20px_rgba(14,116,144,0.25)]"
      )}
      style={{
        background,
        color: textColor,
        borderColor: withAlpha(ringColor, 0.65),
        boxShadow: `0 8px 18px ${withAlpha(ringColor, 0.15)}, inset 0 1px 0 rgba(255,255,255,0.08)`,
      }}
    >
      <div className="min-w-0 text-[9px] uppercase tracking-[0.32em] text-slate-100/80">
        {metric === "mea" ? "MOO" : "REF"}
      </div>
      <div className="flex flex-1 flex-col items-end">
        <span className="font-mono text-sm leading-tight tracking-tight">{formatted}</span>
        {metric === "mea" && idPercent != null ? (
          <span className="text-[10px] text-emerald-100">
            {formatPercent(idPercent, { precision: 7, minimumFractionDigits: 7, fallback: "-" })}
          </span>
        ) : null}
      </div>
    </button>
  );
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
  const columnCount = cols.length || 1;
  const cellWidth = useMemo(
    () => Math.max(72, Math.min(148, Math.floor(960 / Math.max(columnCount, 1)))),
    [columnCount]
  );
  const rowHeaderWidth = Math.max(64, Math.min(128, Math.floor(cellWidth * 0.85)));
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

  const renderCell = (rowIdx: number, colIdx: number) => {
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
        <td key={`${base}-${quote}`} className="p-0.5" style={{ minWidth: cellWidth }}>
          <div className="pointer-events-none flex min-h-[48px] items-center justify-center rounded-2xl border border-slate-800/50 bg-slate-900/40 text-[11px] text-slate-500">
            —
          </div>
        </td>
      );
    }

    const meaValue = safeValue(mea, rowIdx, colIdx);
    const refValue = safeValue(ref, rowIdx, colIdx);
    const idValue = safeValue(idPct, rowIdx, colIdx);

    const frozen =
      Boolean(frozenGrid?.[rowIdx]?.[colIdx]) ||
      (idValue != null && Math.abs(idValue) <= FREEZE_EPS) ||
      (refValue != null && Math.abs(refValue) <= FREEZE_EPS);

    const meaPresentation = resolveCellPresentation({
      rules: MEA_COLOR_RULES,
      value: meaValue,
      frozen,
      directSymbol,
      inverseSymbol,
      symbolSets,
    });

    const refPresentation = resolveCellPresentation({
      rules: REF_COLOR_RULES,
      value: refValue,
      frozen,
      directSymbol,
      inverseSymbol,
      symbolSets,
    });

    const isSelected = selectedBase === base && selectedQuote === quote;
    const ringColor = meaPresentation.ringColor ?? refPresentation.ringColor ?? "rgba(148,163,184,0.3)";

    return (
      <td key={`${base}-${quote}`} className="p-0.5 align-top" style={{ minWidth: cellWidth }}>
        <div
          className={classNames(
            "rounded-2xl border border-transparent bg-[#04070d]/85 p-2",
            "transition-shadow",
            isSelected ? "shadow-[0_0_0_2px_rgba(94,234,212,0.55)]" : "shadow-[0_4px_20px_rgba(2,6,23,0.45)]"
          )}
          style={{
            borderColor: withAlpha(ringColor, 0.45),
            boxShadow: `${isSelected ? "0 8px 22px rgba(59,130,246,0.3)" : "0 8px 22px rgba(15,23,42,0.45)"}, inset 0 0 0 1px ${withAlpha(
              ringColor,
              0.2
            )}`,
          }}
          title={`${base}/${quote}`}
        >
          <div className="flex items-center justify-between text-[9px] uppercase tracking-[0.28em] text-emerald-100/80">
            <span className="font-mono text-[10px] tracking-[0.28em] text-emerald-50">{`${base}/${quote}`}</span>
            {idValue != null ? (
              <span className="rounded-full border border-emerald-400/30 bg-emerald-400/10 px-2 py-[1px] font-mono text-[10px] text-emerald-50">
                {formatPercent(idValue, { precision: 2, fallback: "-" })}
              </span>
            ) : (
              <span className="rounded-full border border-amber-400/40 bg-amber-400/15 px-2 py-[1px] text-[10px] text-amber-100">null</span>
            )}
          </div>
          <div className="mt-1 flex flex-col gap-1">
            <MetricButton
              metric="mea"
              value={meaValue}
              presentation={meaPresentation}
              disabled={!pairAllowed || meaValue == null}
              idPercent={idValue}
              onClick={() =>
                onSelect?.({
                  base,
                  quote,
                  value: meaValue,
                  metric: "mea",
                  assetId: `${base}/${quote}`,
                })
              }
            />
            <MetricButton
              metric="ref"
              value={refValue}
              presentation={refPresentation}
              disabled={!pairAllowed || refValue == null}
              onClick={() =>
                onSelect?.({
                  base,
                  quote,
                  value: refValue,
                  metric: "ref",
                  assetId: `${base}/${quote}`,
                })
              }
            />
          </div>
        </div>
      </td>
    );
  };

  return (
    <DynamicsCard
      title="Dynamics matrix"
      subtitle="MOO & REF spreads"
      status={status}
      className={classNames(
        "rounded-[26px] border border-emerald-400/20 bg-[#02070e]/95 shadow-[0_20px_48px_rgba(0,0,0,0.5)] backdrop-blur",
        className
      )}
      contentClassName="flex flex-col gap-4"
    >
      <div className="flex flex-wrap items-center gap-2 text-[11px] text-emerald-50/80">
        <span className="rounded-full border border-emerald-300/40 bg-emerald-300/10 px-2.5 py-[2px]">MOO values</span>
        <span className="rounded-full border border-cyan-300/40 bg-cyan-300/10 px-2.5 py-[2px]">REF values</span>
        <span className="rounded-full border border-emerald-400/50 px-2.5 py-[2px] text-emerald-50/80">
          Green rings: direct preview
        </span>
        <span className="rounded-full border border-rose-400/50 px-2.5 py-[2px] text-emerald-50/80">
          Red rings: anti-symmetry
        </span>
        <span className="rounded-full border border-slate-400/50 px-2.5 py-[2px] text-emerald-50/80">
          Grey rings: bridged
        </span>
        <span className="rounded-full border border-purple-400/60 px-2.5 py-[2px] text-emerald-50/80">
          Purple rings: frozen
        </span>
        <span className="rounded-full border border-amber-400/50 px-2.5 py-[2px] text-amber-100/90">Yellow: null</span>
      </div>

      <div className="flex-1 rounded-[24px] border border-emerald-400/15 bg-[#01050b]/85 p-0.5 shadow-[inset_0_1px_0_rgba(94,234,212,0.15)]">
        {rows.length === 0 || cols.length === 0 ? (
          <div className="px-4 py-8 text-sm text-emerald-200/70">Matrix data unavailable.</div>
        ) : (
          <div className="overflow-hidden rounded-[22px]">
            <table className="w-full table-fixed border-separate border-spacing-0 text-[10px]">
              <thead className="sticky top-0 z-10 bg-[#03101a]/95 text-emerald-50/70 backdrop-blur">
                <tr>
                  <th
                    className="px-3 py-2 text-left font-semibold uppercase tracking-[0.24em] text-emerald-50/80"
                    style={{ width: rowHeaderWidth }}
                  >
                    Base
                  </th>
                  {cols.map((coin) => (
                    <th
                      key={`head-${coin}`}
                      className="px-1.5 py-2 text-right font-mono text-[10px] uppercase tracking-[0.2em] text-emerald-50/70"
                      style={{ width: cellWidth }}
                    >
                      <span className="block truncate">{coin}</span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((base, rowIdx) => (
                  <tr key={base}>
                    <th
                      scope="row"
                      className="bg-[#03101a]/70 px-3 py-2 text-left font-semibold uppercase tracking-[0.3em] text-emerald-50"
                      style={{ width: rowHeaderWidth }}
                    >
                      {base}
                    </th>
                    {cols.map((_, colIdx) => renderCell(rowIdx, colIdx))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </DynamicsCard>
  );
}
