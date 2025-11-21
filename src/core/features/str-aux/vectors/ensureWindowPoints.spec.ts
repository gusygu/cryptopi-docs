import { describe, it, expect, vi } from "vitest";

import { SamplingStore } from "@/core/features/str-aux/sampling/store";
import { DEFAULT_SAMPLER_CONFIG } from "@/core/features/str-aux/sampling/utils";
import type { SamplingPoint } from "@/core/features/str-aux/sampling";
import {
  ensureWindowPoints,
  minSamplesTarget,
} from "@/core/features/str-aux/vectors/ensureWindowPoints";

const SYMBOL = "BTCUSDT";
const STEP = DEFAULT_SAMPLER_CONFIG.pointIntervalMs;

function makePoint(idx: number): SamplingPoint {
  const ts = idx * STEP;
  const mid = 100 + idx * 0.01;
  return {
    symbol: SYMBOL,
    ts,
    mid,
    bestBid: mid - 0.1,
    bestAsk: mid + 0.1,
    spread: 0.2,
    bidVolume: 1,
    askVolume: 1.2,
    bucketStart: Math.floor(ts / STEP) * STEP,
    bucketEnd: Math.floor(ts / STEP) * STEP + STEP,
    book: {
      bids: [{ price: mid - 0.2, qty: 1 }],
      asks: [{ price: mid + 0.2, qty: 1 }],
    },
  };
}

describe("ensureWindowPoints", () => {
  it("forces sampling until the min target is reached", async () => {
    const store = new SamplingStore(DEFAULT_SAMPLER_CONFIG);
    let idx = 0;

    const raw = await ensureWindowPoints(store, SYMBOL, "30m", 256, {
      pointFactory: () => makePoint(idx++),
      sleepMsOverride: 0,
      maxCycles: 80,
    });

    expect(raw.length).toBeGreaterThanOrEqual(minSamplesTarget(256));
  });

  it("returns existing samples when threshold already satisfied", async () => {
    const store = new SamplingStore(DEFAULT_SAMPLER_CONFIG);
    const target = minSamplesTarget(64);
    for (let i = 0; i < target; i++) {
      await store.collect(SYMBOL, { force: true, point: makePoint(i) });
    }

    const spy = vi.spyOn(store, "collect");
    const raw = await ensureWindowPoints(store, SYMBOL, "30m", 64, {
      pointFactory: () => makePoint(9999),
      sleepMsOverride: 0,
    });

    expect(spy).not.toHaveBeenCalled();
    expect(raw.length).toBeGreaterThanOrEqual(target);
    spy.mockRestore();
  });
});
