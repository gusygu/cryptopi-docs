// src/core/pipelines/computeTick.ts
import type { PollTick, PipelineSettings } from "./types";

/* ---------- task descriptors ---------- */

export type TaskDescriptor =
  | { type: "matrices.persist";    bases: string[]; quote: string; window?: string }
  | { type: "matrices.transient";  bases: string[]; quote: string }
  | { type: "straux.sample";       sample: string[]; quote: string; size: number }
  | { type: "window.aggregate";    windowMs: number; quote: string }
  | { type: "reference.snapshot";  atTs: number; quote: string };

export type TaskExecutor = (task: TaskDescriptor, tick: PollTick, settings: PipelineSettings) => Promise<void>;
export type TaskExecutorRegistry = Record<TaskDescriptor["type"], TaskExecutor>;

/* ---------- planner ---------- */

export function planTasksForTick(tick: PollTick, settings: PipelineSettings): TaskDescriptor[] {
  const out: TaskDescriptor[] = [];
  const S = settings.matrices;
  const bases = uniqUpper(S.bases);
  const quote = S.quote.toUpperCase();

  switch (tick.scale) {
    case "cycle": {
      if (S.persist) {
        out.push({ type: "matrices.persist", bases, quote, window: S.window });
      } else {
        out.push({ type: "matrices.transient", bases, quote });
      }
      break;
    }

    case "sampling": {
      // minimal sampling for str-aux
      const size = clamp(Math.ceil(bases.length * 0.2), 1, Math.max(1, Math.floor(bases.length / 2)));
      const sample = deterministicSample(bases, size, tick.cycleTs);
      out.push({ type: "straux.sample", sample, quote, size });
      break;
    }

    case "window": {
      const wMs = toWindowMs(settings);
      if (wMs) out.push({ type: "window.aggregate", windowMs: wMs, quote });
      break;
    }

    case "reference": {
      out.push({ type: "reference.snapshot", atTs: tick.cycleTs, quote });
      break;
    }

    case "loop":
    case "continuous":
    default:
      // no default tasks; you can add lightweight health probes here
      break;
  }

  return out;
}

/* ---------- helpers (pure) ---------- */

function uniqUpper(xs: string[]) { return [...new Set(xs.map(s => s.toUpperCase()))]; }
function clamp(n: number, a: number, b: number) { return Math.max(a, Math.min(b, n)); }

function mulberry32(seed: number) {
  let t = seed >>> 0;
  return () => {
    t += 0x6D2B79F5; let r = Math.imul(t ^ (t >>> 15), 1 | t); r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

function deterministicSample<T>(arr: T[], k: number, seedTs: number): T[] {
  const rnd = mulberry32(seedTs);
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a.slice(0, k);
}

function toWindowMs(settings: PipelineSettings): number | null {
  const s = settings.scales?.window?.period;
  if (!s) return null;
  if (typeof s === "number") return s;
  // naive parse "15m"/"1h" using your session.parseDuration if you prefer; here quick parse:
  const m = String(s).match(/^(\d+)(ms|s|m|h|d)$/i);
  if (!m) return null;
  const v = Number(m[1]); const u = m[2].toLowerCase();
  if (u === "ms") return v;
  if (u === "s") return v * 1_000;
  if (u === "m") return v * 60_000;
  if (u === "h") return v * 3_600_000;
  if (u === "d") return v * 86_400_000;
  return null;
}
