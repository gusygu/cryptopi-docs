// src/core/pipelines/types.ts

export type Logger = {
  debug: (...a: any[]) => void;
  info:  (...a: any[]) => void;
  warn:  (...a: any[]) => void;
  error: (...a: any[]) => void;
};

export type PollKind =
  | "continuous"  // 1s heartbeat / continuous fetch
  | "sampling"    // light sampling (e.g., str-aux)
  | "cycle"       // main driver cadence (e.g., 1m)
  | "loop"        // one-shot unit of cycle
  | "window"      // aggregated window (e.g., 15m)
  | "reference";  // induced ref time (freezeshots)

export type ScalesSettings = {
  continuous?: { period: number | string }; // default "1s"
  sampling?:   { period: number | string }; // e.g. "5s"
  cycle:       { period: number | string }; // e.g. "1m"
  window?:     { period: number | string }; // e.g. "15m"
};

export type PollTick = {
  cycleTs: number;                 // aligned timestamp for THIS scale
  periodMs: number;                // period of THIS scale
  appSessionId?: string | null;
  reason?: "interval" | "manual" | "backfill" | "reference";
  scale?: PollKind;                // which scale emitted this tick
};

export type RefSelector =
  | { kind: "opening"; window?: string }
  | { kind: "matrix"; matrixType: "benchmark" | "delta" | "pct24h" | "id_pct" | "pct_drv"; ts?: number }
  | { kind: "reference"; refId: string }
  | { kind: "metric"; metricKey: string; ts?: number }
  | { kind: "custom"; overrideValue: number };

export type MatricesSettings = {
  bases: string[];
  quote: string;                 // default "USDT"
  source: "binance" | "mock" | string;
  period: number | string;       // e.g. "1m" | 60000
  persist: boolean;              // write to DB when true
  window?: string;               // "1h" for openings
  ref?: RefSelector;             // optional reference rule
};

export type PipelineSettings = {
  matrices: MatricesSettings;
  scales: ScalesSettings;
};

export type PriceBook = {
  direct: Record<string, number>;     // "BASE/QUOTE" -> price
  open24h: Record<string, number>;    // 24h open estimate (if available)
  usdt: Record<string, number>;       // "SYM/USDT" for bridging
};

export type DepthSnapshot = {
  pair: string;                        // "BASE/QUOTE"
  lastUpdateId?: number;
  bids: [number, number][];            // [price, qty] descending
  asks: [number, number][];            // [price, qty] ascending
  source: "binance" | string;
};

export type BalancesMap = Record<string, number>;

export type LiveSnapshot = {
  priceBook: PriceBook;
  orderBooks: Record<string, DepthSnapshot>;
  wallet: BalancesMap;
};

export type MatrixType = "benchmark" | "pct24h" | "delta" | "id_pct" | "pct_drv";

export type OrchestratorCtx = {
  settings: PipelineSettings;
  logger?: Logger;
};

