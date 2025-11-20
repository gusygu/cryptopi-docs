import { describe, it, expect } from "vitest";

import { SamplingStore } from "./store";
import { DEFAULT_SAMPLER_CONFIG } from "./utils";
import type { SamplingPoint, SamplingWindowKey } from "./types";

const SYMBOL = "BTCUSDT";
const STEP = DEFAULT_SAMPLER_CONFIG.pointIntervalMs;

function makePoint(ts: number): SamplingPoint {
  const mid = 100 + ts / 1_000_000;
  const bucketStart = Math.floor(ts / STEP) * STEP;
  const bucketEnd = bucketStart + STEP;
  return {
    symbol: SYMBOL,
    ts,
    mid,
    bestBid: mid - 0.1,
    bestAsk: mid + 0.1,
    spread: 0.2,
    bidVolume: 10,
    askVolume: 12,
    bucketStart,
    bucketEnd,
    book: {
      bids: [{ price: mid - 0.3, qty: 5 }],
      asks: [{ price: mid + 0.3, qty: 6 }],
    },
  };
}

async function streamSamples(store: SamplingStore, totalMarks: number) {
  const totalSamples = totalMarks * store.expectedPoints + 1;
  for (let i = 0; i < totalSamples; i++) {
    const ts = i * STEP;
    await store.collect(SYMBOL, { force: true, point: makePoint(ts) });
  }
}

describe("SamplingStore", () => {
  it("collects 5s points and emits marks with expected samples per 40s cycle", async () => {
    const store = new SamplingStore(DEFAULT_SAMPLER_CONFIG);
    await streamSamples(store, 1);

    const marks = store.getMarks(SYMBOL, "30m");
    expect(marks).toHaveLength(1);
    const mark = marks[0]!;

    expect(mark.pointsCount).toBe(store.expectedPoints);
    expect(mark.health.expectedPoints).toBeGreaterThanOrEqual(store.expectedPoints - 1);

    const timestamps = mark.points.map((p) => p.ts);
    expect(timestamps).toEqual([...timestamps].sort((a, b) => a - b));
    for (let i = 1; i < timestamps.length; i++) {
      expect(timestamps[i] - timestamps[i - 1]).toBe(STEP);
    }
    expect(mark.points.every((p) => p.book.bids.length + p.book.asks.length > 0)).toBe(true);

    const history = store.getPoints(SYMBOL, "30m");
    expect(history.length).toBe(store.expectedPoints + 1);
    expect(history[0]?.ts).toBe(0);
    expect(history[history.length - 1]?.ts).toBe(DEFAULT_SAMPLER_CONFIG.cycleDurationMs);
  });

  it("maintains sequential marks and window capacities across 30m/1h/3h buffers", async () => {
    const store = new SamplingStore(DEFAULT_SAMPLER_CONFIG);
    const targetMarks = DEFAULT_SAMPLER_CONFIG.windows["3h"].capacity + 5;
    await streamSamples(store, targetMarks);

    const assertWindow = (key: SamplingWindowKey) => {
      const cap = DEFAULT_SAMPLER_CONFIG.windows[key].capacity;
      const marks = store.getMarks(SYMBOL, key);
      expect(marks.length).toBe(cap);

      const starts = marks.map((m) => m.startedAt);
      expect(starts).toEqual([...starts].sort((a, b) => a - b));

      const marksProduced = targetMarks;
      const firstIdx = marksProduced - cap;
      const expectedFirst = firstIdx * DEFAULT_SAMPLER_CONFIG.cycleDurationMs;
      const expectedLast = (marksProduced - 1) * DEFAULT_SAMPLER_CONFIG.cycleDurationMs;

      expect(marks[0]?.startedAt).toBe(expectedFirst);
      expect(marks[marks.length - 1]?.startedAt).toBe(expectedLast);
    };

    assertWindow("30m");
    assertWindow("1h");
    assertWindow("3h");
  });
});
