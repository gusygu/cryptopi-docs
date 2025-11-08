// src/str-aux/frame/analytics.ts
// STR-AUX frame-level analytics: apply GFM shift logic + streams stamping
// Rule: if |ΔGFM %| > epsilonPct for 5 consecutive cycles ⇒ mark shift & update streams.
//
// This module is intentionally small and framework-free so it can be reused
// from API routes or jobs. No DB access here — just pure session/state mutation.

export type ShiftWindowState = {
  // rolling window of boolean flags for "delta exceeded epsilonPct" per cycle
  exceed: boolean[];
  // rolling counters for each sample processed
  counts?: number[];
  // last computed delta in percent points
  lastDeltaPct?: number;
  // total shifts detected (lifetime, maintained by caller if persisted)
  shifts?: number;
  // current streak of consecutive qualifying cycles
  streak?: number;
  // total cycles processed
  totalCycles?: number;
};

export type StreamsState = {
  // minimal sketch - caller can extend
  lastShiftTs?: number;
  lastShiftPrice?: number;
  lastShiftGfm?: number;
  // recent stamps (fixed size for UI)
  stamps?: Array<{ ts: number; price: number; gfm: number; deltaPct: number }>;
  maxStamps?: number; // default 64
  benchmark?: { prev: number | null; cur: number | null; greatest: number | null };
  pct24h?: { prev: number | null; cur: number | null; greatest: number | null };
  pct_drv?: { prev: number | null; cur: number | null; greatest: number | null };
  vSwap?: { prev: number | null; cur: number | null; greatest: number | null };
  vTendency?: { prev: number | null; cur: number | null; greatest: number | null };
  vInner?: { prev: number | null; cur: number | null; greatest: number | null };
  vOuter?: { prev: number | null; cur: number | null; greatest: number | null };
  inertia?: { prev: number | null; cur: number | null; greatest: number | null };
  amp?: { prev: number | null; cur: number | null; greatest: number | null };
  volt?: { prev: number | null; cur: number | null; greatest: number | null };
  efficiency?: { prev: number | null; cur: number | null; greatest: number | null };
};

export type ApplyGfmShiftOpts = {
  epsilonPct?: number; // threshold in percentage points (default 0.35%)
  windowSize?: number; // consecutive cycles needed (default 5)
  nowTs?: number;      // override clock if needed
  price?: number;      // last price at this cycle (for stamping)
};

/**
 * Update shift window & streams given current GFM vs reference.
 * Returns flags telling the caller whether this cycle stamped a new shift.
 */
export function applyGfmShiftAndStreams(
  gfm: number,          // current GFM (absolute)
  refGfm: number,       // reference GFM (absolute)
  state: ShiftWindowState,
  streams: StreamsState,
  opts: ApplyGfmShiftOpts = {}
): { isShift: boolean; deltaPct: number; window: ShiftWindowState; streams: StreamsState } {
  const epsilonPct = opts.epsilonPct ?? 0.35; // %
  const windowSize = Math.max(1, Math.floor(opts.windowSize ?? 5));
  const now = opts.nowTs ?? Date.now();
  const validRef = Number.isFinite(refGfm) && refGfm > 0;
  const validCur = Number.isFinite(gfm) && gfm >= 0;

  // convert delta to percent of full scale (0..1 ⇒ 0..100%)
  const deltaPct = validRef && validCur ? ((gfm / refGfm) - 1) * 100 : NaN;

  // slide window
  const exceeded = Number.isFinite(deltaPct) && deltaPct >= epsilonPct;
  const nextExceed = (state.exceed ?? []).slice(-windowSize + 1).concat([exceeded]);
  const prevCounts = state.counts ?? [];
  const nextCounts = prevCounts.slice(-windowSize + 1);
  const lastCount = prevCounts.length ? prevCounts[prevCounts.length - 1] : 0;
  nextCounts.push(lastCount + 1);

  const prevStreak = state.streak ?? 0;
  const streak = exceeded ? prevStreak + 1 : 0;
  const totalCycles = (state.totalCycles ?? 0) + 1;

  // condition: streak reached required window size
  const reached = streak >= windowSize;

  let isShift = false;
  const outStreams: StreamsState = { ...streams };
  const outState: ShiftWindowState = {
    exceed: nextExceed,
    counts: nextCounts,
    lastDeltaPct: Number.isFinite(deltaPct) ? deltaPct : state.lastDeltaPct,
    shifts: state.shifts ?? 0,
    streak: reached ? 0 : streak,
    totalCycles,
  };

  if (reached) {
    isShift = true;
    outState.shifts = (outState.shifts ?? 0) + 1;

    const stamp = {
      ts: now,
      price: Number.isFinite(opts.price as number) ? (opts.price as number) : NaN,
      gfm,
      deltaPct,
    };

    const maxStamps = outStreams.maxStamps ?? 64;
    const stamps = (outStreams.stamps ?? []).slice(-(maxStamps - 1)).concat([stamp]);

    outStreams.lastShiftTs = now;
    outStreams.lastShiftPrice = stamp.price;
    outStreams.lastShiftGfm = gfm;
    outStreams.stamps = stamps;
    outStreams.maxStamps = maxStamps;
  }

  return { isShift, deltaPct, window: outState, streams: outStreams };
}
