import type { SamplingWindowKey, SamplingPoint } from "@/core/features/str-aux/sampling";
import { SamplingStore } from "@/core/features/str-aux/sampling/store";
import { DEFAULT_SAMPLER_CONFIG } from "@/core/features/str-aux/sampling/utils";

const DEFAULT_MIN_TARGET = 12;
export const MAX_FORCE_CYCLES = 16;

export const minSamplesTarget = (bins: number) =>
  Math.max(DEFAULT_MIN_TARGET, Math.min(128, Math.ceil(bins / 4)));

export type EnsureWindowOptions = {
  maxCycles?: number;
  pointFactory?: (cycle: number, currentSamples: number) => SamplingPoint | null | undefined;
  sleepMsOverride?: number;
};

export async function ensureWindowPoints(
  store: SamplingStore,
  symbol: string,
  window: SamplingWindowKey,
  bins: number,
  options: EnsureWindowOptions = {}
): Promise<SamplingPoint[]> {
  let raw: SamplingPoint[] = store.getPoints(symbol, window);
  const target = minSamplesTarget(bins);
  const maxCycles = options.maxCycles ?? MAX_FORCE_CYCLES;
  const sleepMs =
    options.sleepMsOverride != null ? Math.max(0, options.sleepMsOverride) : DEFAULT_SAMPLER_CONFIG.pointIntervalMs;
  let cycles = 0;

  while (raw.length < target && cycles < maxCycles) {
    const forcedPoint = options.pointFactory?.(cycles, raw.length);
    await store.collect(symbol, forcedPoint ? { force: true, point: forcedPoint } : { force: true });
    raw = store.getPoints(symbol, window);
    cycles += 1;
    if (raw.length < target && cycles < maxCycles && sleepMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, sleepMs));
    }
  }

  return raw;
}
