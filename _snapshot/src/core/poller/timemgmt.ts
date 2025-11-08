// src/core/poller/timemgmt.ts
import { floorToPeriod, parseDuration, align } from "@/core/db/session";
import type { PollTick } from "@/core/pipelines/types";

/** Describe a period around a reference ts */
export function inspectPeriod(period: number | string, ts: number | "now" = "now") {
  const p = typeof period === "number" ? period : parseDuration(period);
  const ref = ts === "now" ? Date.now() : ts;
  const floor = floorToPeriod(ref, p);
  return {
    periodMs: p,
    now: ref,
    floor,
    ceil: floor + p,
    prev: floor - p,
    next: floor + p,
  };
}

export function ticksInRange(period: number | string, startTs: number, endTs: number): PollTick[] {
  const p = typeof period === "number" ? period : parseDuration(period);
  const first = align(startTs, p, "ceil");
  const out: PollTick[] = [];
  for (let t = first; t <= endTs; t += p) {
    out.push({ cycleTs: t, periodMs: p, reason: "manual" });
  }
  return out;
}

export function nextTickAfter(period: number | string, ts: number): PollTick {
  const p = typeof period === "number" ? period : parseDuration(period);
  const n = align(ts, p, "ceil");
  return { cycleTs: n, periodMs: p, reason: "manual" };
}

export function prevTickBefore(period: number | string, ts: number): PollTick {
  const p = typeof period === "number" ? period : parseDuration(period);
  const f = floorToPeriod(ts, p);
  return { cycleTs: f, periodMs: p, reason: "manual" };
}
