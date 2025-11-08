// src/core/features/str-aux/schedule.ts
import { db } from "@/core/db/db";
import { floorToPeriod, parseDuration } from "@/core/db/session";
import type { PollTick, PipelineSettings } from "@/core/pipelines/types";
import type { SamplingPlan, Timeframes } from "../schema";

/** Options that affect how we choose time windows in real time */
export type TimeOpts = {
  /** Back off from the current tick to allow DB writes to settle */
  safeLagMs?: number;              // default 1500
  /** If true, clamp window start >= session start (from DB) */
  clampToSession?: boolean;        // default true
  /** Reference mode (for “freezeshot” / comparative panels) */
  reference?: { kind: "none" | "explicitTs" | "previousWindow" | "sessionStart"; ts?: number };
};

const DEFAULTS: Required<Pick<TimeOpts, "safeLagMs" | "clampToSession">> = {
  safeLagMs: 1500,
  clampToSession: true,
};

function toMs(x: number | string) { return typeof x === "number" ? x : parseDuration(x); }

export async function getSessionStartMs(appSessionId?: string | null): Promise<number | null> {
  if (!appSessionId) return null;
  try {
    // Try generic session table; adjust to your actual ddl if needed.
    const { rows } = await db.query<{ session_start_ms: number }>(
      `SELECT session_start_ms
         FROM app_sessions
        WHERE app_session_id=$1
        ORDER BY session_start_ms DESC
        LIMIT 1`,
      [appSessionId]
    );
    return rows.length ? Number(rows[0].session_start_ms) : null;
  } catch {
    return null;
  }
}

/** Compose cycle/window frames, latency guard, and reference anchor. */
export async function makeTimeframes(
  tick: PollTick,
  settings: PipelineSettings,
  opts: TimeOpts = {}
): Promise<{ frames: Timeframes; referenceTs: number | null }> {
  const safeLagMs      = opts.safeLagMs ?? DEFAULTS.safeLagMs;
  const clampToSession = opts.clampToSession ?? DEFAULTS.clampToSession;

  const cycleMs  = toMs(settings.scales.cycle.period);
  const windowMs = settings.scales.window?.period ? toMs(settings.scales.window.period) : null;

  // latency guard: move evaluation point back by safeLagMs
  const evalTs = Math.max(0, (tick.cycleTs ?? Date.now()) - safeLagMs);

  // cycle frame aligned to cycle period
  const cycleStart = floorToPeriod(evalTs, cycleMs);
  const cycleEnd   = cycleStart + cycleMs;

  // window frame (optional)
  let windowStart = windowMs ? floorToPeriod(evalTs, windowMs) : null;
  let windowEnd   = windowMs ? (windowStart! + windowMs) : null;

  // clamp to session start if requested
  if (clampToSession && (tick.appSessionId || "").length) {
    const s0 = await getSessionStartMs(tick.appSessionId);
    if (s0 && windowStart && windowStart < s0) windowStart = s0;
    if (s0 && windowEnd   && windowEnd   < s0) windowEnd   = s0 + (windowMs ?? 0);
  }

  // derive reference timestamp
  let referenceTs: number | null = null;
  switch (opts.reference?.kind) {
    case "explicitTs":
      referenceTs = opts.reference.ts ?? null;
      break;
    case "previousWindow":
      if (windowMs && windowStart != null) referenceTs = windowStart - 1; // last ms of previous window
      break;
    case "sessionStart": {
      const s0 = await getSessionStartMs(tick.appSessionId);
      referenceTs = s0 ?? null;
      break;
    }
    case "none":
    default:
      referenceTs = null;
  }

  const frames: Timeframes = { cycleStart, cycleEnd, windowStart, windowEnd };
  return { frames, referenceTs };
}

/** Deterministic proportional sample based on sampling vs cycle periods. */
export function proportionalSample(bases: string[], tick: PollTick, settings: PipelineSettings): string[] {
  const total = bases.length || 0;
  if (!total) return [];

  const cycleMs = toMs(settings.scales.cycle.period);
  const sampMs  = settings.scales.sampling?.period ? toMs(settings.scales.sampling.period) : 5000;

  // Share of bases to sample this tick: between 10% and 50%, scaled by samp/cycle
  const prop = Math.min(0.5, Math.max(0.1, sampMs / cycleMs));
  const k    = Math.max(1, Math.min(total, Math.round(total * prop)));

  const rnd = mulberry32(tick.cycleTs);
  const a = bases.map(s => s.toUpperCase());
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a.slice(0, k);
}

export function makeSamplingPlan(
  bases: string[],
  quote: string,
  tick: PollTick,
  settings: PipelineSettings,
  depth = 5
): SamplingPlan {
  const sample = proportionalSample(bases, tick, settings);
  return { bases: [...new Set(bases.map(b => b.toUpperCase()))], quote: quote.toUpperCase(), sample, depth };
}

/** Utilities */
function mulberry32(seed: number) {
  let t = seed >>> 0;
  return () => {
    t += 0x6D2B79F5; let r = Math.imul(t ^ (t >>> 15), 1 | t); r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}
