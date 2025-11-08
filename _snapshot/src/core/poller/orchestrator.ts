// src/core/poller/orchestrator.ts
import type { PollTick, PipelineSettings } from "@/core/pipelines/types";
import type { TaskDescriptor, TaskExecutorRegistry } from "@/core/pipelines/metronome";
import { planTasksForTick } from "@/core/pipelines/metronome";
import { Scheduler } from "./scheduler";
import { PollHub } from "./scales";

export type OrchestratorCtx = {
  settings: PipelineSettings;
  hub: PollHub;                       // the multi-scale clock you already have
  executors: TaskExecutorRegistry;    // mapping: task.type -> executor
  logger?: Console;
};

export class Orchestrator {
  private sched = new Scheduler();
  private stopFns: (() => void)[] = [];
  constructor(private ctx: OrchestratorCtx) {}

  start() {
    // subscribe to the scales we actually plan against
    const sub = async (scale: "continuous" | "sampling" | "cycle" | "window" | "reference" | "loop") => {
      (async () => {
        for await (const t of this.ctx.hub.subscribe(scale)) {
          await this.onTick(t);
        }
      })().catch(e => this.ctx.logger?.error?.("orchestrator.subscribe.err", e));
    };
    ["continuous","sampling","cycle","window","reference","loop"].forEach(s => sub(s as any));
  }

  stop() { this.stopFns.forEach(f => f()); this.stopFns = []; }

  private async onTick(t: PollTick) {
    const tasks = planTasksForTick(t, this.ctx.settings);
    if (!tasks.length) return;

    // run sequentially by default; you can parallelize if tasks are independent
    for (const task of tasks) {
      const exec = this.ctx.executors[task.type];
      if (!exec) {
        this.ctx.logger?.warn?.("orchestrator.no-executor", { type: task.type });
        continue;
      }
      try { await exec(task, t, this.ctx.settings); }
      catch (e) { this.ctx.logger?.error?.("orchestrator.task.err", { type: task.type, err: e }); }
    }
  }
}
