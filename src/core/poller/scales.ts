// src/core/poller/scales.ts
import { Metronome } from "./tempo";
import { Scheduler, every } from "./scheduler";
import { floorToPeriod, parseDuration } from "@/core/db/session";
import type { PollTick, PollKind, ScalesSettings } from "@/core/pipelines/types";

type Listener = (t: PollTick) => void;

export class PollHub {
  private base: Metronome;
  private sched = new Scheduler();
  private listeners = new Map<PollKind, Set<Listener>>();
  private appSessionId: string | null;

  private periods: Record<PollKind, number | undefined>;

  constructor(scales: ScalesSettings, opts?: { appSessionId?: string | null; label?: string }) {
    const cycleMsRaw = (scales as any)?.cycle?.period ?? (scales as any)?.cycle ?? "1m";
    const cycleMs = toMs(cycleMsRaw);
    const requestedContinuous = scales.continuous?.period ? toMs(scales.continuous.period) : undefined;
    const requestedSampling   = scales.sampling?.period   ? toMs(scales.sampling.period)   : undefined;
    const requestedWindow     = scales.window?.period     ? toMs(scales.window.period)     : undefined;

    const alignedContinuous = requestedContinuous ? alignToCycle(requestedContinuous, cycleMs) : undefined;
    const alignedSampling   = requestedSampling   ? alignToCycle(requestedSampling,   cycleMs) : undefined;
    const alignedWindow     = requestedWindow     ? alignToCycle(requestedWindow,     cycleMs) : undefined;

    const basePeriod = gcdList([cycleMs, alignedContinuous, alignedSampling, alignedWindow]);
    const continuousMs = alignedContinuous ?? basePeriod;
    const samplingMs   = alignedSampling ?? undefined;
    const windowMs     = alignedWindow ?? undefined;

    this.periods = {
      continuous: continuousMs,
      sampling:   samplingMs,
      cycle:      cycleMs,
      loop:       cycleMs,
      window:     windowMs,
      reference:  cycleMs,
    };

    this.appSessionId = opts?.appSessionId ?? null;

    this.base = new Metronome({
      periodMs: basePeriod,
      appSessionId: this.appSessionId,
      label: opts?.label ?? "universal-base",
      immediate: true,
    });

    this.sched.register({
      name: "scale:continuous",
      when: () => true,
      run: (tBase) => this.emit("continuous", alignTick(tBase, continuousMs)),
    });

    if (samplingMs) {
      const k = Math.max(1, Math.round(samplingMs / basePeriod));
      this.sched.register({
        name: "scale:sampling",
        when: every(k),
        run: (tBase) => this.emit("sampling", alignTick(tBase, samplingMs)),
      });
    }

    {
      const k = Math.max(1, Math.round(cycleMs / basePeriod));
      this.sched.register({
        name: "scale:cycle",
        when: every(k),
        run: (tBase) => this.emit("cycle", alignTick(tBase, cycleMs)),
      });
    }

    if (windowMs) {
      const k = Math.max(1, Math.round(windowMs / basePeriod));
      this.sched.register({
        name: "scale:window",
        when: every(k),
        run: (tBase) => this.emit("window", alignTick(tBase, windowMs)),
      });
    }

    this.base.on((t) => this.sched.onTick(t));
  }

  start() { this.base.start(); }
  stop()  { this.base.stop(); }

  on(kind: PollKind, fn: Listener) {
    if (!this.listeners.has(kind)) this.listeners.set(kind, new Set());
    this.listeners.get(kind)!.add(fn);
    return () => this.listeners.get(kind)!.delete(fn);
  }

  /** Async stream per scale */
  async *subscribe(kind: PollKind): AsyncIterable<PollTick> {
    const queue: PollTick[] = [];
    let pending: ((t: PollTick) => void) | null = null;

    const off = this.on(kind, (t) => {
      if (pending) { const p = pending; pending = null; p(t); }
      else queue.push(t);
    });

    try {
      while (this.base.isRunning()) {
        if (queue.length) { yield queue.shift()!; continue; }
        const next = await new Promise<PollTick>(res => { pending = res; });
        yield next;
      }
    } finally {
      off();
    }
  }

  /** One-shot unit of cycle */
  triggerLoop(now = Date.now()) {
    const ms = this.periods.cycle!;
    const cycleTs = floorToPeriod(now, ms);
    const t: PollTick = { cycleTs, periodMs: ms, appSessionId: this.appSessionId, reason: "manual", scale: "loop" };
    this.emit("loop", t);
  }

  /** Induced referential tick (freezeshot/backfill) */
  triggerReference(referenceTs: number) {
    const ms = this.periods.cycle!;
    const cycleTs = floorToPeriod(referenceTs, ms);
    const t: PollTick = { cycleTs, periodMs: ms, appSessionId: this.appSessionId, reason: "reference", scale: "reference" };
    this.emit("reference", t);
  }

  private emit(kind: PollKind, t: PollTick) {
    const tick: PollTick = { ...t, scale: kind };
    const set = this.listeners.get(kind);
    if (!set?.size) return;
    for (const fn of set) {
      try { fn(tick); } catch { /* swallow; add logger if needed */ }
    }
  }
}

/* ───────────────────── helpers ───────────────────── */

function toMs(x: number | string) {
  return typeof x === "number" ? x : parseDuration(x);
}

function alignTick(baseTick: PollTick, periodMs: number): PollTick {
  const cycleTs = floorToPeriod(baseTick.cycleTs, periodMs);
  return { cycleTs, periodMs, appSessionId: baseTick.appSessionId, reason: baseTick.reason };
}

function gcdList(values: Array<number | undefined>): number {
  const nums = values.filter((v): v is number => typeof v === "number" && Number.isFinite(v) && v > 0);
  if (!nums.length) return 60_000;
  return nums.reduce((acc, val) => gcd(acc, val), nums[0]);
}

function gcd(a: number, b: number): number {
  let x = Math.abs(a);
  let y = Math.abs(b);
  while (y) {
    const t = y;
    y = x % y;
    x = t;
  }
  return x || 1;
}

function alignToCycle(value: number, cycleMs: number): number {
  if (!Number.isFinite(value) || value <= 0) return cycleMs;
  if (Math.abs(value - cycleMs) < 1) return cycleMs;
  if (value > cycleMs) {
    const factor = Math.max(1, Math.round(value / cycleMs));
    return factor * cycleMs;
  }
  const ratio = cycleMs / value;
  const rounded = Math.round(ratio);
  if (rounded > 0 && Math.abs(ratio - rounded) < 1e-6) {
    return cycleMs / rounded;
  }
  return cycleMs;
}
