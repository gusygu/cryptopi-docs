export type PersistResult = { ok: boolean; count: number };
export type BuildPanelArgs = {
  snapshot: StrAuxSnapshot;
  includeInnerMatrices?: boolean;
};

// src/core/features/str-aux/schema.ts
import type { PollTick, PipelineSettings } from "@/core/pipelines/types";

/** ——— generic symbols/time ——— */
export type Sym = string;

export type Timeframes = {
  cycleStart: number;
  cycleEnd: number;
  windowStart: number | null;
  windowEnd: number | null;
};

export type SamplingPlan = {
  bases: Sym[];
  quote: Sym;
  sample: Sym[];
  depth: number;
};

/** ——— orderbook snapshots ——— */
export type OBLevel = [price: number, qty: number];
export type DepthSnapshot = { pair: string; bids: OBLevel[]; asks: OBLevel[]; lastUpdateId?: number; source?: string };

/** ——— streams point (for panel streams matrix) ——— */
export type StrAuxPoint = {
  symbol: Sym;               // "BASE/QUOTE"
  mid: number | null;        // midpoint price
  spreadBps: number | null;  // 10_000 * (ask1 - bid1) / mid
  topImbalance: number | null; // (Σ bidQtyN - Σ askQtyN) / (Σ bidQtyN + Σ bidQtyN)
  liqScore: number | null;   // [0..1] heuristic liquidity score
};

export type StrAuxSnapshot = {
  tick: PollTick;
  frames: Timeframes;
  points: StrAuxPoint[];
};

/** ——— vectors/statistics payloads ——— */
export type Series = number[];

// IDHR nucleus used by our tendency code (values are residuals inside a bin)
export type Nucleus = { values: number[]; weights?: number[]; center?: number };

// IDHR result (minimal shape we need here)
export type IdhrResult = {
  nuclei: Nucleus[];     // nuclei as above, or transformed before use
  bins: number;          // total bins in histogram
  sigma: number;         // robust dispersion (for display)
  gfm: number;           // floating mode level
  zAbs: number;          // |price - gfm| / sigma
  deltaGfm: number;      // change vs previous gfm (if you compute it)
  shifted: boolean;      // regime shift flag
};

/** ——— panel ——— */
export type PanelCell = { key: string; value: number | string | null; hint?: string };
export type Panel = { rows: PanelCell[] };

export type RunCtx = { settings: PipelineSettings; tick: PollTick };
