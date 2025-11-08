export type ShiftStamp = {
  ts: number;
  price: number;
  gfm: number;
  deltaPct: number;
};

export type StreamsRow = {
  prev?: number | null;
  cur?: number | null;
  greatest?: number | null;
};

export type StreamsSnapshot = {
  lastShiftTs?: number;
  lastShiftPrice?: number;
  lastShiftGfm?: number;
  stamps?: ShiftStamp[];
  maxStamps?: number;
  benchmark?: StreamsRow;
  pct24h?: StreamsRow;
  pct_drv?: StreamsRow;
  vSwap?: StreamsRow;
  vTendency?: StreamsRow;
};

export type StrAuxCards = {
  opening?: { benchmark?: number; pct24h?: number };
  live?: { benchmark?: number; pct24h?: number; pct_drv?: number };
};

export type StrAuxStats = {
  bfm01?: number;
  deltaBfmPct?: number;
  gfmAbs?: number;
  deltaGfmPct?: number;
  sigma?: number;
  zAbs?: number;
  vInner?: number;
  vOuter?: number;
  tendency?: {
    direction?: number;
    strength?: number;
    slope?: number;
    r?: number;
    score?: number;
  };
  inertia?: { static?: number; growth?: number; total?: number; face?: 'static' | 'growth' };
  amp?: number;
  volt?: number;
  efficiency?: number;
  opening?: number;
  last?: number;
  prev?: number;
};

export type StrAuxExtrema = {
  priceMin?: number;
  priceMax?: number;
  benchPctMin?: number;
  benchPctMax?: number;
};

export type StrAuxMeta = {
  uiEpoch?: number;
  epsPct?: number;
  kCycles?: number;
};

export type StrAuxCoinOut = {
  ok: boolean;
  window?: string;
  n?: number;
  cards?: StrAuxCards;
  stats?: StrAuxStats;
  fm?: {
    sigma?: number;
    zAbs?: number;
    inertia?: { static?: number; growth?: number; total?: number; face?: 'static' | 'growth' };
    amp?: number;
    volt?: number;
    efficiency?: number;
    nuclei?: { binIndex: number }[];
  };
  hist?: { counts: number[] };
  streams?: StreamsSnapshot;
  shifts?: {
    nShifts?: number;
    latestTs?: number;
    counts?: number[];
    shiftstamp?: boolean[];
    streak?: number;
    totalCycles?: number;
    deltaPct?: number | null;
    openingGfm?: number | null;
    refGfm?: number | null;
    latestGfm?: number | null;
    epsilonPct?: number | null;
    windowSize?: number | null;
  };
  shift_stamp?: boolean;
  extrema?: StrAuxExtrema;
  meta?: StrAuxMeta;
  lastUpdateTs?: number;
  error?: string;
};

export type PairAvailability = {
  usdt: string[];
  cross: string[];
  all: string[];
};

export type StrAuxResponse = {
  ok: boolean;
  ts: number;
  window: string;
  symbols: string[];
  out: Record<string, StrAuxCoinOut>;
  available?: PairAvailability;
  selected?: string[];
  timing?: { autoRefreshMs?: number; secondaryEnabled?: boolean; secondaryCycles?: number };
};
