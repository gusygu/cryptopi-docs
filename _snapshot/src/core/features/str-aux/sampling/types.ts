// src/core/features/str-aux/sampling/types.ts
export type SamplingWindowKey = "30m" | "1h" | "3h";

export type SamplingHealthStatus = "ok" | "warn" | "error";

export type SamplingPoint = {
  symbol: string;
  ts: number;
  mid: number;
  bestBid: number;
  bestAsk: number;
  spread: number;
  bidVolume: number;
  askVolume: number;
};

export type SamplingMark = {
  id: string;
  symbol: string;
  startedAt: number;
  closedAt: number;
  durationMs: number;
  pointsCount: number;
  price: {
    open: number;
    close: number;
    min: number;
    max: number;
    avg: number;
  };
  spread: {
    min: number;
    max: number;
    avg: number;
  };
  volume: {
    bid: number;
    ask: number;
    total: number;
  };
  points: SamplingPoint[];
  health: {
    status: SamplingHealthStatus;
    notes: string[];
    expectedPoints: number;
  };
};

export type SamplingWindowSummary = {
  key: SamplingWindowKey;
  capacity: number;
  size: number;
  marks: SamplingMark[];
  statusCounts: Record<SamplingHealthStatus, number>;
};

export type SamplingCycleSnapshot = {
  startedAt: number | null;
  pointsCollected: number;
  expectedPoints: number;
  closingAt: number | null;
  status: SamplingHealthStatus;
  notes: string[];
};

export type SamplingSnapshot = {
  symbol: string;
  cycle: SamplingCycleSnapshot;
  windows: Record<SamplingWindowKey, SamplingWindowSummary>;
  lastPoint: SamplingPoint | null;
  lastClosedMark: SamplingMark | null;
  historySize: number;
};

export type SamplerWindowConfig = {
  durationMs: number;
  capacity: number;
};

export type SamplerConfig = {
  pointIntervalMs: number;
  cycleDurationMs: number;
  windows: Record<SamplingWindowKey, SamplerWindowConfig>;
};
