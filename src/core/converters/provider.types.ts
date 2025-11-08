// src/core/converters/provider.types.ts
// Shared contracts and domain types used by the converters runtime.

export type Pair = { base: string; quote: string };

export type SwapDirection = "up" | "down" | "frozen";
export type SwapTag = { count: number; direction: SwapDirection; changedAtIso?: string };

export type TimedPoint = { ts_ms: number; value: number };

export type MatrixKey =
  | "benchmark"
  | "id_pct"
  | "pct_drv"
  | "pct24h"
  | "pct_ref"
  | "ref"
  | "delta";

export type MatrixSnapshot = {
  coins: string[];
  grids: Partial<Record<MatrixKey, number[][]>>;
  ts?: number;
  quote?: string;
};

export interface MatricesProvider {
  prepare?(coins: string[]): Promise<void> | void;
  getSnapshot?(params: { coins: string[]; keys?: MatrixKey[] }): Promise<MatrixSnapshot>;
  getBenchmarkGrid(coins: string[]): Promise<number[][] | undefined> | number[][] | undefined;
  getIdPctGrid(coins: string[]): Promise<number[][] | undefined> | number[][] | undefined;
  getPctDrvGrid?(coins: string[]): Promise<number[][] | undefined> | number[][] | undefined;
}

export type CinStat = {
  session: { imprint: number; luggage: number };
  cycle: { imprint: number; luggage: number };
};

export interface CinAuxProvider {
  getWallet(symbol: string): Promise<number | undefined> | number | undefined;
  getCinForCoins(symbols: string[]): Promise<Record<string, CinStat>> | Record<string, CinStat>;
}

export interface MeaAuxProvider {
  getMea(pair: Pair): Promise<{ value: number; tier: string }> | { value: number; tier: string };
  getMeaGrid?(
    input: { coins: string[]; idPct: number[][]; balances: Record<string, number>; k?: number }
  ): Promise<number[][] | undefined> | number[][] | undefined;
}

export interface StrAuxProvider {
  getSwapTag?(edge: { from: string; to: string }): Promise<SwapTag> | SwapTag;
  getIdPctHistory?(from: string, to: string, lastN?: number): Promise<number[]> | number[];
  getIdPctHistoryTs?(from: string, to: string, lastN?: number): Promise<TimedPoint[]> | TimedPoint[];
  getPctDrvHistory?(from: string, to: string, lastN?: number): Promise<number[]> | number[];
  getPctDrvHistoryTs?(from: string, to: string, lastN?: number): Promise<TimedPoint[]> | TimedPoint[];
  getGfm(): Promise<number> | number;
  getShift(): Promise<number> | number;
  getVTendency(pair: Pair): Promise<number> | number;
  getStats?(pair: Pair): Promise<{ gfm?: number; shift?: number; vOuter?: number }> | { gfm?: number; shift?: number; vOuter?: number };
}

export interface WalletHttpProvider {
  getWallet(symbol: string): Promise<number | undefined> | number | undefined;
}

export type ConverterSources = {
  matrices: MatricesProvider;
  mea: MeaAuxProvider;
  str: StrAuxProvider;
  cin: CinAuxProvider;
  wallet?: WalletHttpProvider;
};

export type DomainEdgeMetrics = {
  benchmark: number;
  id_pct: number;
  vTendency?: number;
  swapTag: SwapTag;
};

export type DomainArbRow = {
  ci: string;
  cols: {
    cb_ci: DomainEdgeMetrics;
    ci_ca: DomainEdgeMetrics;
    ca_ci: DomainEdgeMetrics;
  };
};

export type DomainArbSection = {
  rows: DomainArbRow[];
  wallets: Record<string, number>;
};

export type DomainMetricsPanel = {
  mea: { value: number; tier: string };
  str: { gfm: number; shift: number; vTendency: number };
  cin: Record<string, CinStat>;
};

export type DomainSeries = {
  id_pct: number[];
  pct_drv: number[];
  id_pct_ts?: TimedPoint[];
  pct_drv_ts?: TimedPoint[];
};

export type DomainContext = {
  base: string;
  quote: string;
  candidates: string[];
  balances: Record<string, number>;
  histLen: number;
};

export type DomainMatrix = {
  benchmark?: number[][];
  id_pct?: number[][];
  pct_drv?: number[][];
  mea?: number[][];
  ref?: number[][];
};

export type DomainVM = {
  coins: string[];
  matrix: DomainMatrix;
  arb: DomainArbSection;
  metricsPanel: DomainMetricsPanel;
  series: DomainSeries;
  context: DomainContext;
};

export type HistogramSnapshot = {
  buckets: number[];
  counts: number[];
  min: number;
  max: number;
};

export type DynamicsSnapshot = {
  builtAt: number;
  coins: string[];
  base: string;
  quote: string;
  candidates: string[];
  matrix: DomainMatrix;
  arb: DomainArbSection;
  metrics: DomainMetricsPanel;
  series: DomainSeries;
  histogram?: HistogramSnapshot;
  wallets: Record<string, number>;
  walletsAll: Record<string, number>;
  cin: Record<string, CinStat>;
};
