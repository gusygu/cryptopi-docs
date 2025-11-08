// Glue to keep existing imports working: "@/core/pipeline/source"
// It delegates to the SourceAdapter defined under pipelines/pipeline.api.ts

import type { PipelineSettings, PollTick, Logger, LiveSnapshot, DepthSnapshot } from "@/core/pipelines/types";
import { getSourceAdapter } from "@/core/pipelines/pipeline.api";

export async function fetchLiveSnapshot(
  settings: PipelineSettings,
  tick: PollTick,
  logger?: Logger
): Promise<LiveSnapshot> {
  const S = settings.matrices;
  const bases = [...new Set(S.bases.map(s => s.toUpperCase()))];
  const quote = S.quote.toUpperCase();
  const adapter = getSourceAdapter(settings);
  return adapter.fetchLiveSnapshot(bases, quote, { tick, settings, logger });
}

export async function fetchOrderBooks(
  settings: PipelineSettings,
  bases: string[],
  quote: string,
  depth: number,
  tick: PollTick,
  logger?: Logger
): Promise<Record<string, DepthSnapshot>> {
  const adapter = getSourceAdapter(settings);
  if (adapter.fetchOrderBooks) {
    return adapter.fetchOrderBooks(bases, quote, depth, { tick, settings, logger });
  }
  return {};
}
