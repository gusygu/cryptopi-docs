// src/core/features/cin-aux/matrix.ts
import type { CinMetrics } from "./compute";
export type CinRow = { key: string; value: number | string | null };

export function buildCinMatrix(m: CinMetrics): CinRow[] {
  return [
    { key: "throughput", value: m.throughput ?? null },
    { key: "latencyMs",  value: m.latencyMs ?? null },
    { key: "efficiency", value: m.efficiency ?? null },
  ];
}
