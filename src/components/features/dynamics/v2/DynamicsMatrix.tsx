"use client";

import React, { useMemo } from "react";
import { DynamicsCard } from "@/components/features/dynamics/DynamicsCard";
import { classNames, formatNumber, formatPercent, uniqueUpper } from "@/components/features/dynamics/utils";
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
const DIRECT_RING = "rgba(52,211,153,0.85)";
const INVERSE_RING = "rgba(248,113,113,0.85)";
const BRIDGED_RING = "rgba(148,163,184,0.7)";
const FROZEN_RING = "rgba(192,132,252,0.85)";

const ensureUpper = (value: string | null | undefined): string => String(value ?? "").trim().toUpperCase();

const MEA_THRESHOLDS: readonly number[] = [0.0025, 0.005, 0.01, 0.02, 0.04];
const REF_THRESHOLDS: readonly number[] = [0.003, 0.006, 0.012, 0.024, 0.048];

const MEA_COLOR_RULES: MatrixColorRules = {
  key: "mea",
  thresholds: MEA_THRESHOLDS,
  positivePalette: POSITIVE_SHADES,
  negativePalette: NEGATIVE_SHADES,
  zeroFloor: 0.0008,
  derive: (value) => (value == null ? null : value - 1),
  ringStrategy: "none",
};

const REF_COLOR_RULES: MatrixColorRules = {
  key: "ref",
  thresholds: REF_THRESHOLDS,
  positivePalette: POSITIVE_SHADES,
  negativePalette: NEGATIVE_SHADES,
  zeroFloor: 0.0004,
  derive: (value) => value,
  ringStrategy: "none",
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

function deriveRingColor({
  frozen,
  directAvailable,
  inverseAvailable,
}: {
  frozen: boolean;
  directAvailable: boolean;
  inverseAvailable: boolean;
}) {
  if (frozen) return { color: FROZEN_RING, label: "Frozen" };
  if (directAvailable) return { color: DIRECT_RING, label: "Preview available" };
  if (inverseAvailable) return { color: INVERSE_RING, label: "Anti-symmetry route" };
  return { color: BRIDGED_RING, label: "Bridged value" };
}

type MetricButtonProps = {
  metric: MetricKind;
  value: number | null;
  presentation: ReturnType<typeof resolveCellPresentation>;
  disabled: boolean;
  frozen: boolean;
  idPercent?: number | null;
  onClick(): void;
};

function MetricButton({ metric, value, presentation, disabled, idPercent, onClick }: MetricButtonProps) {
  const formatted = formatNumber(value, { fallback: "n/a", precision: 6, minimumFractionDigits: 4 });
  const background = presentation.background;
  const textColor =
    presentation.textColor ??
    (presentation.polarity === "negative" ? "#fef2f2" : presentation.polarity === "positive" ? "#022c22" : "#e2e8f0");

  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={classNames(
        "flex min-h-[64px] flex-col rounded-xl border border-white/5 px-2.5 py-2 text-left transition",
        disabled ? "cursor-not-allowed opacity-55" : "hover:brightness-110"
      )}
      style={{
        background,
        color: textColor,
        boxShadow: "inset 0 1px 0 rgba(255,255,255,0.08)",
      }}
    >
      <div className="flex items-center justify-between text-[10px] uppercase tracking-[0.28em] text-slate-100/70">
        <span>{metric === "mea" ? "MEA" : "REF"}</span>
        {metric === "mea" && idPercent != null ? (
          <span className="font-mono text-[10px] text-slate-100">{formatPercent(idPercent, { precision: 2, fallback: "-" })}</span>
        ) : null}
      </div>
      <div className="mt-1 font-mono text-sm">{formatted}</div>
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
        <td key={`${base}-${quote}`} className="p-1 text-center">
          <div className="pointer-events-none flex min-h-[120px] items-center justify-center rounded-2xl border border-slate-700/40 bg-[rgba(15,23,42,0.55)] text-sm text-slate-400">
            -
          </div>
        </td>
      );
    }

    const directAvailable = previewSymbols.has(directSymbol);
    const inverseAvailable = previewSymbols.has(inverseSymbol);

    const meaValue = safeValue(mea, rowIdx, colIdx);
    const refValue = safeValue(ref, rowIdx, colIdx);
    const idValue = safeValue(idPct, rowIdx, colIdx);

    const frozen =
      Boolean(frozenGrid?.[rowIdx]?.[colIdx]) ||
      (idValue != null && Math.abs(idValue) <= FREEZE_EPS);

    const ring = deriveRingColor({ frozen, directAvailable, inverseAvailable });

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

    return (
      <td key={`${base}-${quote}`} className="p-1 align-top">
        <div
          className={classNames(
            "rounded-2xl border p-1.5",
            isSelected ? "shadow-[0_0_0_2px_rgba(59,130,246,0.45)]" : ""
          )}
          style={{
            borderColor: ring.color,
            boxShadow: `0 0 0 1px ${withAlpha(ring.color, 0.4)}`,
          }}
          title={ring.label}
        >
          <div className="grid gap-1">
            <MetricButton
              metric="mea"
              value={meaValue}
              presentation={meaPresentation}
              frozen={frozen}
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
              frozen={frozen}
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
      subtitle="MEA & REF per pair"
      status={status}
      className={classNames(
        "rounded-3xl border border-emerald-500/25 bg-[#050810]/90 shadow-[0_0_32px_rgba(16,185,129,0.18)] backdrop-blur",
        className
      )}
      contentClassName="flex flex-col gap-3"
    >
      <div className="flex flex-wrap items-center gap-3 text-[11px] text-emerald-200/80">
        <span className="rounded-full border border-emerald-500/40 bg-emerald-500/10 px-2 py-[2px]">MEA (upper)</span>
        <span className="rounded-full border border-cyan-500/40 bg-cyan-500/10 px-2 py-[2px]">REF (lower)</span>
        <span className="rounded-full border border-emerald-400/40 px-2 py-[2px] text-emerald-200/80">
          Green border: direct preview
        </span>
        <span className="rounded-full border border-rose-400/40 px-2 py-[2px] text-emerald-200/80">
          Red border: anti-symmetry
        </span>
        <span className="rounded-full border border-slate-500/40 px-2 py-[2px] text-emerald-200/80">
          Grey border: bridged
        </span>
        <span className="rounded-full border border-purple-400/40 px-2 py-[2px] text-emerald-200/80">
          Purple: frozen pair
        </span>
      </div>

      <div className="flex-1 rounded-2xl border border-emerald-500/15 bg-black/40">
        {rows.length === 0 || cols.length === 0 ? (
          <div className="px-4 py-8 text-sm text-emerald-200/70">Matrix data unavailable.</div>
        ) : (
          <table className="min-w-[960px] border-separate border-spacing-0 text-[11px]">
            <thead className="sticky top-0 z-10 bg-[#060a12]/95 text-emerald-200/70 backdrop-blur">
              <tr>
                <th className="w-24 px-3 py-2 text-left font-semibold uppercase tracking-[0.25em] text-emerald-300/70">
                  base
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
                <tr key={base}>
                  <th
                    scope="row"
                    className="bg-[#060a12]/80 px-3 py-2 text-left font-semibold uppercase tracking-[0.25em] text-emerald-100"
                  >
                    {base}
                  </th>
                  {cols.map((_, colIdx) => renderCell(rowIdx, colIdx))}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </DynamicsCard>
  );
}
