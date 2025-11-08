// src/core/poller/metronome.ts
import { floorToPeriod } from "@/core/db/session"; // you already have this
import type { PollTick } from "@/core/pipelines/types";

type MetronomeOpts = {
  periodMs: number;                 // e.g. 60_000
  alignToMs?: number;               // epoch alignment (default 0)
  appSessionId?: string | null;
  label?: string;
  immediate?: boolean;              // emit immediately upon start
  now?: () => number;               // inject for tests
};

type Listener = (t: PollTick) => void;

export class Metronome {
  private timer: any = null;
  private running = false;
  private listeners = new Set<Listener>();
  private opts: Required<MetronomeOpts>;

  constructor(opts: MetronomeOpts) {
    const now = opts.now ?? (() => Date.now());
    const alignToMs = opts.alignToMs ?? 0;
    this.opts = { ...opts, now, alignToMs, appSessionId: opts.appSessionId ?? null, label: opts.label ?? "metronome", immediate: !!opts.immediate };
  }

  start() {
    if (this.running) return;
    this.running = true;
    const { periodMs, alignToMs, immediate } = this.opts;

    const tickOnce = () => {
      const now = this.opts.now();
      const cycleTs = floorToPeriod(now, periodMs) - (alignToMs % periodMs + periodMs) % periodMs;
      const tick: PollTick = { cycleTs, periodMs, appSessionId: this.opts.appSessionId ?? undefined, reason: "interval" };
      this.emit(tick);
    };

    const scheduleNext = () => {
      if (!this.running) return;
      const now = this.opts.now();
      // aligned next edge:
      const base = floorToPeriod(now - this.opts.alignToMs, this.opts.periodMs) + this.opts.alignToMs;
      const nextEdge = base + this.opts.periodMs;
      const delay = Math.max(0, nextEdge - now);
      this.timer = setTimeout(() => {
        tickOnce();
        scheduleNext();
      }, delay);
      // Node.js: don't keep the process alive just because of this timer
      if (typeof this.timer?.unref === "function") this.timer.unref();
    };

    if (immediate) tickOnce();
    scheduleNext();
  }

  stop() {
    this.running = false;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  on(fn: Listener) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  private emit(t: PollTick) { for (const fn of this.listeners) fn(t); }

  /** Async iterator for for-await-of */
  async *subscribe(): AsyncIterable<PollTick> {
    const q: PollTick[] = [];
    let resolve: ((v: IteratorResult<PollTick>) => void) | null = null;

    const off = this.on((t) => {
      if (resolve) { const r = resolve; resolve = null; r({ value: t, done: false }); }
      else q.push(t);
    });

    try {
      while (this.running) {
        if (q.length) { yield q.shift()!; continue; }
        const p = new Promise<IteratorResult<PollTick>>(res => { resolve = res; });
        const r = await p;
        yield r.value!;
      }
    } finally { off(); }
  }

  isRunning() { return this.running; }
}
