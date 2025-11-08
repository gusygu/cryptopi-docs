// src/core/features/cin-aux/compute.ts
/** Calculations over the flow artifacts; keep pure if possible */
export type CinMetrics = {
  throughput?: number;
  latencyMs?: number;
  efficiency?: number;
};
export function computeCinMetrics(ctx: any): CinMetrics {
  // derive from flow outputs in ctx
  return { throughput: undefined, latencyMs: undefined, efficiency: undefined };
}
