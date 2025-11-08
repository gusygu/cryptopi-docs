"use client";

import type { CSSProperties, ReactNode } from "react";
import { tsLabel } from "@/lib/format";
import {
  withAlpha,
  COLOR_MUTED,
  COLOR_FROZEN,
  FROZEN_STAGE_COLORS,
  type FrozenStage,
} from "@/components/features/matrices/colors";

export type MatrixCell = {
  value: number | null;
  display: string;
  background: string;
  polarity: "positive" | "negative" | "neutral";
  ringColor?: string | null;
  tooltip?: string;
  isDiagonal?: boolean;
  textColor?: string;
  frozen?: boolean;
  frozenStage?: FrozenStage | null;
  detail?: string | null;
  detailColor?: string;
};

type MatrixProps = {
  title: string;
  subtitle?: string;
  description?: string;
  coins: string[];
  cells: MatrixCell[][];
  timestamp?: number | null;
  gradient?: string;
  footer?: ReactNode;
};

const CARD_BACKGROUND = "linear-gradient(155deg, rgba(13,17,35,0.92), rgba(5,8,18,0.95))";

function getTextColor(cell: MatrixCell | undefined): string {
  if (!cell) return "#cbd5f5";
  if (cell.textColor) return cell.textColor;
  if (cell.isDiagonal) return "#64748b";
  if (cell.value == null || !Number.isFinite(cell.value)) return "#d0d8e5";
  if (cell.polarity === "positive") return "#032e1a";
  if (cell.polarity === "negative") return "#f8fafc";
  return "#0f172a";
}

const diagonalBackground = "rgba(15, 23, 42, 0.55)";

export default function Matrix({
  title,
  subtitle,
  description,
  coins,
  cells,
  timestamp,
  gradient,
  footer,
}: MatrixProps) {
  const tsText = tsLabel(timestamp ?? null);
  const rows = coins.length;
  const cols = coins.length;

  return (
    <article
      className="flex h-full flex-col overflow-hidden rounded-3xl border border-white/10 shadow-[0_48px_120px_-60px_rgba(15,23,42,0.9)] backdrop-blur"
      style={{ background: gradient ?? CARD_BACKGROUND }}
    >
      <header className="border-b border-white/5 px-4 py-3">
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-1">
            {subtitle ? (
              <span className="inline-flex items-center rounded-full bg-white/5 px-3 py-1 text-[11px] uppercase tracking-[0.28em] text-slate-300">
                {subtitle}
              </span>
            ) : null}
            <h2 className="text-base font-semibold text-slate-50 md:text-lg">{title}</h2>
            {description ? (
              <p className="max-w-2xl text-xs leading-relaxed text-slate-300/80">{description}</p>
            ) : null}
          </div>
          <div className="flex flex-col items-end text-[11px] text-slate-400">
            <span className="uppercase tracking-[0.2em] text-slate-500">timestamp</span>
            <span className="font-mono text-[11px] text-slate-300">{tsText}</span>
          </div>
        </div>
      </header>

      <div className="flex-1 overflow-auto px-3 pb-4 pt-3">
        <div className="overflow-x-auto">
          <table className="min-w-full border-separate border-spacing-x-0 border-spacing-y-1 text-[10px]">
            <thead>
              <tr className="text-slate-400">
                <th className="px-2 py-1.5 text-left font-medium text-slate-500">base / quote</th>
                {Array.from({ length: cols }).map((_, j) => (
                  <th key={`head-${j}`} className="px-2 py-1.5 text-right font-mono uppercase tracking-[0.18em] text-slate-400">
                    {coins[j] ?? "?"}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {Array.from({ length: rows }).map((_, i) => (
                <tr key={`row-${coins[i] ?? i}`}>
                  <th className="px-2.5 py-1.5 text-left font-semibold uppercase tracking-[0.18em] text-slate-300">
                    {coins[i] ?? "?"}
                  </th>
                  {Array.from({ length: cols }).map((__, j) => {
                    const cell = cells?.[i]?.[j];
                    const isDiagonal = i === j || cell?.isDiagonal;
                    const display = isDiagonal ? "-" : cell?.display ?? "-";
                    const detail = isDiagonal ? null : cell?.detail ?? null;
                    const detailColor = cell?.detailColor;
                    const hasDetail = Boolean(detail);
                    const rawTooltip = cell?.tooltip;
                    const tooltipBase = rawTooltip ?? `${coins[i]} / ${coins[j]}`;
                    const polarity = cell?.polarity ?? "neutral";
                    const ringColor = cell?.ringColor ?? null;
                    const isFrozenCell = Boolean(cell?.frozen);
                    const freezeLabel = cell?.frozenStage ? `${cell.frozenStage} freeze` : "frozen";

                    const style: CSSProperties = {
                      background: isDiagonal ? diagonalBackground : cell?.background ?? COLOR_MUTED,
                      color: getTextColor(cell ? { ...cell, isDiagonal } : undefined),
                      boxShadow: [
                        "inset 0 1px 0 rgba(255,255,255,0.08)",
                        !isDiagonal && ringColor ? `0 0 0 1px ${withAlpha(ringColor, 0.85)}` : null,
                        !isDiagonal && ringColor ? `0 0 0 4px ${withAlpha(ringColor, 0.28)}` : null,
                      ]
                        .filter(Boolean)
                        .join(", "),
                      border: `1px solid ${ringColor ? ringColor : "rgba(148,163,184,0.18)"}`,
                      outline: !isDiagonal && ringColor ? `2px solid ${withAlpha(ringColor, 0.9)}` : "none",
                      outlineOffset: !isDiagonal && ringColor ? 2 : 0,
                    };

                    if (isDiagonal) {
                      style.border = "1px solid rgba(148,163,184,0.12)";
                      style.boxShadow = "inset 0 1px 0 rgba(255,255,255,0.05)";
                      style.outline = "none";
                      style.outlineOffset = 0;
                    }

                    const textClass = polarity === "negative" ? "font-semibold" : "";
                    const tooltip =
                      isFrozenCell && !rawTooltip ? `${tooltipBase} (${freezeLabel})` : tooltipBase;
                    const ariaLabel = `${coins[i] ?? "?"} to ${coins[j] ?? "?"}: ${display}${
                      isFrozenCell ? ` (${freezeLabel})` : ""
                    }`;
                    const frozenStageColor = cell?.frozenStage ? FROZEN_STAGE_COLORS[cell.frozenStage] : COLOR_FROZEN;

                    return (
                      <td key={`cell-${i}-${j}`} className="px-1 py-1">
                        <div
                          className={`relative rounded-lg px-2 py-1.5 text-right font-mono tabular-nums ${textClass} ${
                            hasDetail ? "leading-tight space-y-0.5" : ""
                          }`}
                          style={style}
                          title={tooltip}
                          aria-label={ariaLabel}
                        >
                          {isFrozenCell ? (
                            <>
                              <span className="sr-only">Frozen</span>
                              <span
                                aria-hidden="true"
                                className="pointer-events-none absolute right-0 top-0 h-4 w-4"
                                style={{
                                  background: withAlpha(frozenStageColor, 0.92),
                                  clipPath: "polygon(100% 0, 0 0, 100% 100%)",
                                  boxShadow: `0 0 10px ${withAlpha(frozenStageColor, 0.55)}`,
                                }}
                              />
                            </>
                          ) : null}
                          <span className="block leading-tight">{display}</span>
                          {hasDetail ? (
                            <span
                              className="block text-[10px] leading-tight"
                              style={{ color: detailColor ?? "rgba(226,232,240,0.82)" }}
                            >
                              {detail}
                            </span>
                          ) : null}
                        </div>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {footer ? (
        <footer className="border-t border-white/5 px-5 py-3 text-xs text-slate-400">{footer}</footer>
      ) : null}
    </article>
  );
}


