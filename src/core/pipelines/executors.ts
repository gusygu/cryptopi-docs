// src/core/pipelines/executors.ts (add)
import type { TaskExecutorRegistry } from "./metronome";
import type { PollTick, PipelineSettings } from "./types";
import { makeSamplingPlan, runStrAuxSnapshot } from "@/core/features/str-aux/frame/analytics";
import { buildPanel, savePanel, savePoints } from "@/core/features/str-aux/panel";

export const executors: TaskExecutorRegistry = {
  // ... keep your other executors

  async "straux.sample"(task: any, tick: PollTick, settings: PipelineSettings) {
    const plan = makeSamplingPlan(task.sample ?? settings.matrices.bases, task.quote ?? settings.matrices.quote, tick, settings, 5);
    const snapshot = await runStrAuxSnapshot({ settings, tick }, plan);
    const panel = buildPanel({ snapshot, includeInnerMatrices: false });
    await savePanel(tick.appSessionId ?? null, snapshot.frames.cycleStart, panel);
    await savePoints(tick.appSessionId ?? null, snapshot.frames.cycleStart, snapshot.points);
  },

  async "window.aggregate"(task: any, tick: PollTick, settings: PipelineSettings) {
    // optional: read last N sampling snapshots from DB and build a window panel
  },
};
