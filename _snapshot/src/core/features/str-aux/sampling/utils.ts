// src/core/features/str-aux/sampling/utils.ts
import {
  type SamplerConfig,
  type SamplingCycleSnapshot,
  type SamplingHealthStatus,
  type SamplingMark,
  type SamplingPoint,
  type SamplingSnapshot,
  type SamplingWindowKey,
  type SamplingWindowSummary,
} from "./types";

export const DEFAULT_SAMPLER_CONFIG: SamplerConfig = {
  pointIntervalMs: 5_000,
  cycleDurationMs: 40_000,
  windows: {
    "30m": { durationMs: 30 * 60 * 1_000, capacity: 45 },
    "1h": { durationMs: 60 * 60 * 1_000, capacity: 90 },
    "3h": { durationMs: 3 * 60 * 60 * 1_000, capacity: 270 },
  },
};

export class SamplingStoreError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SamplingStoreError";
  }
}

export type MarkSummary = {
  id: string;
  symbol: string;
  startedAt: number;
  closedAt: number;
  durationMs: number;
  pointsCount: number;
  expectedPoints: number;
  price: SamplingMark["price"];
  spread: SamplingMark["spread"];
  volume: SamplingMark["volume"];
  health: SamplingMark["health"];
  pointRefs: {
    first: SamplingPoint | null;
    third: SamplingPoint | null;
    last: SamplingPoint | null;
  };
};

export function summarizeMark(mark: SamplingMark): MarkSummary {
  const points = mark.points ?? [];
  return {
    id: mark.id,
    symbol: mark.symbol,
    startedAt: mark.startedAt,
    closedAt: mark.closedAt,
    durationMs: mark.durationMs,
    pointsCount: mark.pointsCount,
    expectedPoints: mark.health.expectedPoints,
    price: mark.price,
    spread: mark.spread,
    volume: mark.volume,
    health: mark.health,
    pointRefs: {
      first: points[0] ?? null,
      third: points[2] ?? null,
      last: points[points.length - 1] ?? null,
    },
  };
}

export function summarizeWindowMarkers(window: SamplingWindowSummary) {
  const picks = (indexes: number[]) =>
    indexes
      .map((i) => (i >= 0 && i < window.marks.length ? window.marks[i] : null))
      .filter((m): m is SamplingMark => Boolean(m));

  const head = picks([0]).map(summarizeMark)[0] ?? null;
  const twentieth = picks([19]).map(summarizeMark)[0] ?? null;
  const twentyFirst = picks([20]).map(summarizeMark)[0] ?? null;
  const tail = picks([window.marks.length - 1]).map(summarizeMark)[0] ?? null;

  return {
    head,
    twentieth,
    twentyFirst,
    tail,
  };
}

export function reduceStatusCounts(marks: SamplingMark[]): Record<SamplingHealthStatus, number> {
  const counts: Record<SamplingHealthStatus, number> = { ok: 0, warn: 0, error: 0 };
  for (const mark of marks) counts[mark.health.status] += 1;
  return counts;
}

export function orderedWindowKeys(): SamplingWindowKey[] {
  return ["30m", "1h", "3h"];
}

export type SamplingWindowDigest = {
  cycle: SamplingCycleSnapshot;
  window: {
    key: SamplingWindowKey;
    capacity: number;
    size: number;
    statusCounts: Record<SamplingHealthStatus, number>;
    markers: ReturnType<typeof summarizeWindowMarkers>;
  };
  lastPoint: SamplingPoint | null;
  lastClosedMark: MarkSummary | null;
};

export function summarizeSnapshotWindow(
  snapshot: SamplingSnapshot,
  key: SamplingWindowKey
): SamplingWindowDigest {
  const summary = snapshot.windows[key];
  return {
    cycle: snapshot.cycle,
    window: {
      key,
      capacity: summary.capacity,
      size: summary.size,
      statusCounts: summary.statusCounts,
      markers: summarizeWindowMarkers(summary),
    },
    lastPoint: snapshot.lastPoint,
    lastClosedMark: snapshot.lastClosedMark ? summarizeMark(snapshot.lastClosedMark) : null,
  };
}
