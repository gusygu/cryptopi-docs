// src/core/features/str-aux/frame/index.ts
import type { PipelineSettings, PollTick } from "@/core/pipelines/types";
import type { SamplingPlan, Timeframes } from "../schema";
import { makeTimeframes, makeSamplingPlan, type TimeOpts } from "./schedule"; // existing file
import { getSourceAdapter } from "@/core/pipelines/pipeline.api";
import type { StrAuxSnapshot, StrAuxPoint } from "../schema";

export type SnapshotWithRefs = {
  frames: Timeframes;
  snapshot: StrAuxSnapshot;
  ref?: { ts: number; points: Record<string, StrAuxPoint> };
};

const EPS = 1e-12;

function calcPoint(pair: string, d: { bids: [number, number][], asks: [number, number][] }): StrAuxPoint {
  const b1 = d.bids?.[0]?.[0] ?? NaN;
  const a1 = d.asks?.[0]?.[0] ?? NaN;
  const mid = Number.isFinite(b1) && Number.isFinite(a1) ? (a1 + b1) / 2 : null;
  const spreadBps = Number.isFinite(b1) && Number.isFinite(a1) && Number.isFinite(mid!)
    ? (10000 * (a1 - b1)) / Math.max(EPS, mid as number)
    : null;

  // optional extras preserved from your earlier calc (topImbalance, liqScore)
  const topImbalance = Number.isFinite(b1) && Number.isFinite(a1)
    ? Math.sign((a1 ?? 0) - (b1 ?? 0))
    : 0;

  return { symbol: pair, mid, spreadBps, topImbalance, liqScore: null };
}

export async function runSnapshotWithRefs(
  settings: PipelineSettings,
  tick: PollTick,
  bases: string[],
  quote: string,
  opts: TimeOpts = {},
  depth = 5
): Promise<SnapshotWithRefs> {
  // frames + plan (existing behavior)
  const { frames, referenceTs } = await makeTimeframes(tick, settings, opts);  // :contentReference[oaicite:3]{index=3}
  const plan: SamplingPlan = makeSamplingPlan(bases, quote, tick, settings, depth); // :contentReference[oaicite:4]{index=4}

  // fetch order books at safe-lag point
  const adapter = getSourceAdapter(settings);
  const depths = await adapter.fetchOrderBooks!(plan.sample, plan.quote, plan.depth, { tick, settings, logger: console });

  const points = plan.sample.map(base => {
    const pair = `${base}/${plan.quote}`;
    const d = depths[pair] ?? { bids: [], asks: [] };
    return calcPoint(pair, d);
  });

  const snapshot: StrAuxSnapshot = { tick, frames, points };

  // optional reference snapshot at referenceTs (unchanged shape)
  let ref: SnapshotWithRefs["ref"] | undefined = undefined;
  if (referenceTs != null) {
    const depthsRef = await adapter.fetchOrderBooks!(plan.sample, plan.quote, plan.depth, {
      tick: { ...tick, cycleTs: referenceTs }, settings, logger: console
    });
    const pointsRef: Record<string, StrAuxPoint> = {};
    for (const base of plan.sample) {
      const pair = `${base}/${plan.quote}`;
      pointsRef[pair] = calcPoint(pair, depthsRef[pair] ?? { bids: [], asks: [] });
    }
    ref = { ts: referenceTs, points: pointsRef };
  }

  return { frames, snapshot, ref };
}
