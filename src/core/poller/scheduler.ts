// src/core/poller/scheduler.ts
import type { PollTick } from "@/core/pipelines/types";

export type Job = {
  name: string;
  when: (t: PollTick) => boolean;            // run gate
  run: (t: PollTick) => Promise<void> | void;
  once?: boolean;                            // remove after first success
  timeoutMs?: number;                        // kill job run if exceeds
  retry?: { max: number; backoffMs?: number };
  dedupeKey?: (t: PollTick) => string;       // suppress duplicates per key
  cooldownMs?: number;                       // min ms between runs (per job)
};

export class Scheduler {
  private jobs = new Map<string, Job>();
  private lastRunAt = new Map<string, number>();
  private inflightKeys = new Set<string>();

  register(job: Job) { this.jobs.set(job.name, job); }
  unregister(name: string) { this.jobs.delete(name); }

  async onTick(t: PollTick) {
    for (const job of this.jobs.values()) {
      if (!job.when(t)) continue;

      const key = job.dedupeKey ? `${job.name}:${job.dedupeKey(t)}` : job.name;
      if (this.inflightKeys.has(key)) continue; // still running
      const lastAt = this.lastRunAt.get(key) ?? 0;
      if (job.cooldownMs && t.cycleTs - lastAt < job.cooldownMs) continue;

      this.inflightKeys.add(key);
      try {
        await this.runWithPolicy(job, t);
        this.lastRunAt.set(key, t.cycleTs);
        if (job.once) this.jobs.delete(job.name);
      } finally {
        this.inflightKeys.delete(key);
      }
    }
  }

  private async runWithPolicy(job: Job, t: PollTick) {
    const attempt = async () => {
      const p = Promise.resolve(job.run(t));
      if (!job.timeoutMs) return await p;
      return await timeout(p, job.timeoutMs, new Error(`job "${job.name}" timed out`));
    };
    const retries = job.retry?.max ?? 0;
    const backoff = job.retry?.backoffMs ?? 0;

    let err: unknown;
    for (let i = 0; i <= retries; i++) {
      try { return await attempt(); }
      catch (e) {
        err = e;
        if (i < retries && backoff > 0) await sleep(backoff);
      }
    }
    throw err;
  }
}

/* ---------- helpers ---------- */
function sleep(ms: number) { return new Promise(res => setTimeout(res, ms)); }
async function timeout<T>(p: Promise<T>, ms: number, err: Error): Promise<T> {
  return await Promise.race([
    p,
    new Promise<T>((_, rej) => setTimeout(() => rej(err), ms)),
  ]);
}

/* ---------- convenience predicates ---------- */
export function every(n: number) {
  return (t: PollTick) => Math.floor(t.cycleTs / t.periodMs) % Math.max(1, n) === 0;
}
export function atOffsets(offsetsMs: number[]) {
  const set = new Set(offsetsMs.map(x => ((x % 2_147_483_647) + 2_147_483_647) % 2_147_483_647));
  return (t: PollTick) => set.has((t.cycleTs % t.periodMs + t.periodMs) % t.periodMs);
}
export function atExactEpoch(ms: number) {
  return (t: PollTick) => t.cycleTs % ms === 0;
}
