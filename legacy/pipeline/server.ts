// src/core/pipeline/server.ts
import { floorToPeriod, parseDuration } from "@/core/db/session";
import { runMatricesCycle, type MatricesCycleResult } from "@/core/pipelines/pipeline";
import type {
  LiveSnapshot,
  Logger,
  OrchestratorCtx,
  PipelineSettings,
  PollTick,
} from "@/core/pipelines/types";
import { fetchLiveSnapshot } from "./source";

function resolvePeriodMs(period: number | string): number {
  if (typeof period === "number") return Math.max(1, Math.floor(period));
  return Math.max(1, Math.floor(parseDuration(period)));
}

export function createCycleTick(
  settings: PipelineSettings,
  at: number = Date.now(),
  reason: PollTick["reason"] = "manual",
  appSessionId?: string | null,
): PollTick {
  const periodMs = resolvePeriodMs(settings.matrices.period ?? 60_000);
  const cycleTs = floorToPeriod(at, periodMs);
  return {
    cycleTs,
    periodMs,
    appSessionId: appSessionId ?? undefined,
    reason,
    scale: "cycle",
  };
}

export type RunCycleOptions = {
  snapshot?: LiveSnapshot;
  logger?: Logger;
};

export async function runCycle(
  settings: PipelineSettings,
  tick: PollTick,
  options: RunCycleOptions = {},
): Promise<MatricesCycleResult> {
  const ctx: OrchestratorCtx = { settings, logger: options.logger };
  const snapshot = options.snapshot ?? (await fetchLiveSnapshot(settings, tick, options.logger));
  return runMatricesCycle(ctx, tick, snapshot);
}

export type RunCycleNowOptions = RunCycleOptions & {
  at?: number;
  reason?: PollTick["reason"];
  appSessionId?: string | null;
};

export async function runCycleNow(
  settings: PipelineSettings,
  options: RunCycleNowOptions = {},
): Promise<MatricesCycleResult> {
  const tick = createCycleTick(
    settings,
    options.at ?? Date.now(),
    options.reason ?? "manual",
    options.appSessionId,
  );
  const snapshot = options.snapshot ?? await fetchLiveSnapshot(settings, tick, options.logger);
  return runCycle(settings, tick, { ...options, snapshot });
}
