// /core/features/str-aux/runner.ts
import type { PipelineSettings, PollTick } from "@/core/pipelines/types";
import { runStrAuxWithTimeRefs, type SnapshotWithRefs } from "@/core/features/str-aux/frame/analytics";
import { buildPanelWithStreams } from "@/core/features/str-aux/panel";
import { runExecAndUpdateSession, type ExecBundle } from "./calc/stats.exec";
import { getAuxCoins } from "./context";

export type RunResult = {
  frames: SnapshotWithRefs["frames"];
  snapshot: SnapshotWithRefs["snapshot"];
  ref?: SnapshotWithRefs["ref"];
  exec: ExecBundle[];
  panel?: ReturnType<typeof buildPanelWithStreams>;
};

/** end-to-end tick: context → snapshot → exec → (optional) panel */
export async function runStrAuxTick(
  settings: PipelineSettings,
  tick: PollTick,
  opts: Parameters<typeof runStrAuxWithTimeRefs>[4] = { reference: { kind: "previousWindow" } },
  depth = 5,
  buildPanel = true,
  seriesBuffers: Record<string, { ts: number; price: number }[]> = {},
  pct24hMap?: Record<string, number>,
): Promise<RunResult> {
  const coins = await getAuxCoins();
  const bases = coins.filter((c) => c !== "USDT");
  const quote = "USDT";

  // snapshot (frames + points + optional ref)
  const sref = await runStrAuxWithTimeRefs(settings, tick, bases, quote, opts, depth);

  // exec (IDHR + vectors + inertia + session update)
  const exec = runExecAndUpdateSession(tick.appSessionId || "default", sref, seriesBuffers, pct24hMap);

  // optional panel for debugging/telemetry
  const panel = buildPanel ? buildPanelWithStreams(sref, false) : undefined;
  return { frames: sref.frames, snapshot: sref.snapshot, ref: sref.ref, exec, panel };
}
