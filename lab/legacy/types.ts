// src/core/features/matrices/types.ts

// Re-export the table row contract used by /matrices pages

// Local copy of the selector types (kept minimal, matches project types)
export type RefKind = "opening" | "reference" | "metric" | "matrix" | "custom";

export type ReferenceSelector = {
  kind: RefKind;
  // 'reference'
  refId?: string;
  // 'metric'
  metricKey?: string;
  // 'matrix'
  matrixType?: "benchmark" | "delta" | "pct24h" | "id_pct" | "pct_drv";
  ts?: number;
  // 'custom'
  overrideValue?: number;
};

export type PriceBook = {
  // live prices (preferred)
  direct: Record<string, number>;       // "BASE/QUOTE" => price
  // optional helpers for deltas
  open24h?: Record<string, number>;     // "BASE/QUOTE" => 24h opening price
  prev?: Record<string, number>;        // "BASE/QUOTE" => previous snapshot price
  // optional USDT legs for bridging when no direct/cross exists
  usdt?: Record<string, number>;        // "SYM/USDT" => price
};

// Build parameters the selector understands
export type SelectorParams = {
  bases: string[];
  quote?: string;
  priceBook: PriceBook;
  // optional – if you later want to fetch “opening” from DB by session/window
  appSessionId?: string | null;
  window?: string; // e.g. "1h"
  ref?: ReferenceSelector; // override reference rule
};


// Feature-facing types for /matrices API & UI table.
// Keep these lightweight and stable for the page renderer.
//
// NOTE: This file intentionally does NOT depend on the project-layer types.
// It defines the UI-table shape consumed by /app/matrices and related components.

export type MatrixRow = {
  /** e.g. "BTCUSDT" */
  symbol: string;

  /** Percent-like fields are nullable numbers in FRACTION form (e.g., 0.0123 = 1.23%) */
  benchPct: number | null;   // Bench % (UI-friendly alias; currently mirrors 24h% for the pair)
  pctDrv: number | null;     // “drv %” (session drift vs previous snapshot)
  pct24h: number | null;     // 24h change
  pct_ref: number | null;    // delta vs reference (fraction)
  ref: number | null;        // resolved reference value (price/benchmark)
  id_pct: number | null;     // identification delta (if/when available)

  /** Extra metadata used by the UI (not all columns are always rendered) */
  base: string;
  quote: string;
  benchmark?: number | null;
  delta?: number | null;
  frozen?: boolean;
  bridged?: boolean;
};

/** Column helpers kept here for convenience (optional for API layer) */
export const fmtPct = (v: number | null | undefined) =>
  v == null ? "-" : `${(v * 100).toFixed(2)}%`;

export const fmtNum = (v: number | null | undefined) =>
  v == null ? "-" : Number(v).toLocaleString();

// Feature-facing types for /matrices API & UI table.
// Keep these lightweight and stable for the page renderer.
//
// NOTE: This file intentionally does NOT depend on the project-layer types.
// It defines the UI-table shape consumed by /app/matrices and related components.

