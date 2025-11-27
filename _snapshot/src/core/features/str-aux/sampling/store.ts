// src/core/features/str-aux/sampling/store.ts
import { fetchOrderBook } from "@/core/sources/binance";
import {
  DEFAULT_SAMPLER_CONFIG,
  SamplingStoreError,
} from "./utils";
import type {
  SamplerConfig,
  SamplingHealthStatus,
  SamplingMark,
  SamplingPoint,
  SamplingSnapshot,
  SamplingWindowKey,
  SamplingWindowSummary,
} from "./types";

type SymbolState = {
  currentStart: number | null;
  currentPoints: SamplingPoint[];
  lastPoint: SamplingPoint | null;
  lastClosedMark: SamplingMark | null;
  history: SamplingPoint[];
  windows: Record<SamplingWindowKey, SamplingMark[]>;
};

const clampStatus = (status: SamplingHealthStatus, target: SamplingHealthStatus): SamplingHealthStatus => {
  if (status === "error" || target === "error") return "error";
  if (status === "warn" || target === "warn") return "warn";
  return "ok";
};

export type CollectResult = {
  point: SamplingPoint | null;
  closedMark: SamplingMark | null;
  snapshot: SamplingSnapshot;
};

export class SamplingStore {
  readonly config: SamplerConfig;
  private readonly states = new Map<string, SymbolState>();
  private readonly maxWindowDurationMs: number;
  private readonly expectedPointsPerCycle: number;

  constructor(config: SamplerConfig = DEFAULT_SAMPLER_CONFIG) {
    this.config = config;
    this.maxWindowDurationMs = Math.max(...Object.values(config.windows).map((w) => w.durationMs));
    this.expectedPointsPerCycle = Math.max(1, Math.round(config.cycleDurationMs / config.pointIntervalMs));
  }

  async collect(symbol: string, opts?: { force?: boolean; point?: SamplingPoint }): Promise<CollectResult> {
    const symbolKey = this.normalizeSymbol(symbol);
    const state = this.ensureState(symbolKey);
    const now = Date.now();

    if (opts?.point) {
      const mark = this.pushPoint(symbolKey, { ...opts.point, symbol: symbolKey });
      return { point: opts.point, closedMark: mark, snapshot: this.snapshot(symbolKey, state) };
    }

    if (!opts?.force && state.lastPoint && now - state.lastPoint.ts < this.config.pointIntervalMs * 0.75) {
      return { point: null, closedMark: null, snapshot: this.snapshot(symbolKey, state) };
    }

    const point = await this.fetchPoint(symbolKey);
    if (!point) {
      return { point: null, closedMark: null, snapshot: this.snapshot(symbolKey, state) };
    }

    const mark = this.pushPoint(symbolKey, point);
    return { point, closedMark: mark, snapshot: this.snapshot(symbolKey, state) };
  }

  getPoints(symbol: string, window: SamplingWindowKey): SamplingPoint[] {
    const symbolKey = this.normalizeSymbol(symbol);
    const state = this.states.get(symbolKey);
    if (!state) return [];
    const durationMs = this.config.windows[window]?.durationMs ?? this.maxWindowDurationMs;
    const refTs = state.lastPoint?.ts ?? Date.now();
    const cutoff = refTs - durationMs;
    const list = state.history;
    let idx = 0;
    while (idx < list.length && list[idx].ts < cutoff) idx += 1;
    return list.slice(idx);
  }

  getMarks(symbol: string, window: SamplingWindowKey): SamplingMark[] {
    const state = this.states.get(this.normalizeSymbol(symbol));
    if (!state) return [];
    return [...state.windows[window]];
  }

  snapshot(symbol: string, stateOverride?: SymbolState): SamplingSnapshot {
    const symbolKey = this.normalizeSymbol(symbol);
    const state = stateOverride ?? this.ensureState(symbolKey);
    const cycleStatus = this.computeCycleStatus(state, Date.now());

    const windows: Record<SamplingWindowKey, SamplingWindowSummary> = {
      "30m": this.buildWindowSummary("30m", state),
      "1h": this.buildWindowSummary("1h", state),
      "3h": this.buildWindowSummary("3h", state),
    };

    return {
      symbol: symbolKey,
      cycle: cycleStatus,
      windows,
      lastPoint: state.lastPoint,
      lastClosedMark: state.lastClosedMark,
      historySize: state.history.length,
    };
  }

  get expectedPoints(): number {
    return this.expectedPointsPerCycle;
  }

  private normalizeSymbol(symbol: string): string {
    return String(symbol ?? "").trim().toUpperCase();
  }

  private ensureState(symbol: string): SymbolState {
    const existing = this.states.get(symbol);
    if (existing) return existing;
    const init: SymbolState = {
      currentStart: null,
      currentPoints: [],
      lastPoint: null,
      lastClosedMark: null,
      history: [],
      windows: {
        "30m": [],
        "1h": [],
        "3h": [],
      },
    };
    this.states.set(symbol, init);
    return init;
  }

  private async fetchPoint(symbol: string): Promise<SamplingPoint | null> {
    try {
      const ob = await fetchOrderBook(symbol, 50);
      if (!(ob.mid > 0)) return null;
      const ts = ob.ts ?? Date.now();
      const bestBid = Number.isFinite(ob.bestBid) ? ob.bestBid : ob.mid;
      const bestAsk = Number.isFinite(ob.bestAsk) ? ob.bestAsk : ob.mid;
      const spread = Number.isFinite(bestBid) && Number.isFinite(bestAsk) ? Math.abs(bestAsk - bestBid) : 0;
      return {
        symbol,
        ts,
        mid: ob.mid,
        bestBid,
        bestAsk,
        spread,
        bidVolume: Number.isFinite(ob.bidVol) ? ob.bidVol : 0,
        askVolume: Number.isFinite(ob.askVol) ? ob.askVol : 0,
      };
    } catch (err) {
      if (err instanceof SamplingStoreError) throw err;
      return null;
    }
  }

  private pushPoint(symbol: string, point: SamplingPoint): SamplingMark | null {
    const state = this.ensureState(symbol);
    const ts = point.ts;
    if (state.lastPoint && ts <= state.lastPoint.ts) {
      point = { ...point, ts: state.lastPoint.ts + 1 };
    }

    state.lastPoint = point;
    state.history.push(point);
    this.pruneHistory(state);

    if (!state.currentPoints.length) {
      state.currentPoints = [point];
      state.currentStart = point.ts;
      return null;
    }

    const cycleStart = state.currentStart ?? state.currentPoints[0]?.ts ?? point.ts;
    state.currentStart = cycleStart;
    const elapsed = ts - cycleStart;
    if (elapsed < this.config.cycleDurationMs) {
      state.currentPoints.push(point);
      return null;
    }

    const mark = this.buildMark(symbol, cycleStart, state.currentPoints);
    this.storeMark(state, mark);
    state.lastClosedMark = mark;
    state.currentPoints = [point];
    state.currentStart = point.ts;
    return mark;
  }

  private pruneHistory(state: SymbolState) {
    const cutoff = (state.lastPoint?.ts ?? Date.now()) - this.maxWindowDurationMs;
    let drop = 0;
    while (drop < state.history.length && state.history[drop].ts < cutoff) drop += 1;
    if (drop > 0) state.history.splice(0, drop);
  }

  private buildMark(symbol: string, startedAt: number | null, points: SamplingPoint[]): SamplingMark {
    const list = [...points].sort((a, b) => a.ts - b.ts);
    const first = list[0];
    const last = list[list.length - 1] ?? first;
    const priceValues = list.map((p) => p.mid).filter((v) => Number.isFinite(v));
    const spreadValues = list.map((p) => p.spread).filter((v) => Number.isFinite(v));
    const bidVolumes = list.map((p) => p.bidVolume).filter((v) => Number.isFinite(v));
    const askVolumes = list.map((p) => p.askVolume).filter((v) => Number.isFinite(v));

    const priceMin = priceValues.length ? Math.min(...priceValues) : NaN;
    const priceMax = priceValues.length ? Math.max(...priceValues) : NaN;
    const priceAvg = priceValues.length ? priceValues.reduce((s, v) => s + v, 0) / priceValues.length : NaN;

    const spreadMin = spreadValues.length ? Math.min(...spreadValues) : NaN;
    const spreadMax = spreadValues.length ? Math.max(...spreadValues) : NaN;
    const spreadAvg = spreadValues.length ? spreadValues.reduce((s, v) => s + v, 0) / spreadValues.length : NaN;

    const bidVolume = bidVolumes.reduce((s, v) => s + v, 0);
    const askVolume = askVolumes.reduce((s, v) => s + v, 0);

    const expectedNominal = this.expectedPointsPerCycle;
    const actualDurationMs =
      last && startedAt !== null ? Math.max(0, last.ts - startedAt) : this.config.cycleDurationMs;
    const expectedFromDuration = Math.max(1, Math.round(actualDurationMs / this.config.pointIntervalMs));
    const expectedPoints = Math.min(expectedNominal, Math.max(1, expectedFromDuration));
    const warnFloor = Math.max(1, Math.ceil(expectedPoints * 0.5));
    const tolerance = Math.max(1, Math.ceil(expectedPoints * 0.25));
    const minOk = Math.max(1, expectedPoints - tolerance);
    let status: SamplingHealthStatus = "ok";
    const notes: string[] = [];
    if (!list.length) {
      status = "error";
      notes.push("empty_cycle");
    } else {
      if (priceValues.length === 0) {
        status = "error";
        notes.push("no_prices");
      }
      if (list.length < warnFloor) {
        status = clampStatus(status, "warn");
        notes.push("too_few_points");
      } else if (list.length < minOk) {
        status = clampStatus(status, "warn");
        notes.push("partial_cycle");
      }
      if (last && startedAt !== null) {
        const intended = this.config.cycleDurationMs;
        const delta = (last.ts - startedAt) - intended;
        if (delta > this.config.pointIntervalMs) {
          status = clampStatus(status, "warn");
          notes.push("extended_cycle");
        }
      }
    }

    const startTs = startedAt ?? (first?.ts ?? last?.ts ?? Date.now());
    const closeTs = last?.ts ?? startTs;

    return {
      id: `${symbol}:${startTs}`,
      symbol,
      startedAt: startTs,
      closedAt: closeTs,
      durationMs: Math.max(0, closeTs - startTs),
      pointsCount: list.length,
      price: {
        open: first?.mid ?? NaN,
        close: last?.mid ?? NaN,
        min: priceMin,
        max: priceMax,
        avg: priceAvg,
      },
      spread: {
        min: spreadMin,
        max: spreadMax,
        avg: spreadAvg,
      },
      volume: {
        bid: bidVolume,
        ask: askVolume,
        total: bidVolume + askVolume,
      },
      points: list,
      health: {
        status,
        notes,
        expectedPoints,
      },
    };
  }

  private storeMark(state: SymbolState, mark: SamplingMark) {
    for (const key of Object.keys(this.config.windows) as SamplingWindowKey[]) {
      const window = state.windows[key];
      window.push(mark);
      const cap = this.config.windows[key]?.capacity ?? window.length;
      while (window.length > cap) window.shift();
    }
  }

  private computeCycleStatus(state: SymbolState, now: number) {
    const points = state.currentPoints.length;
    const expectedNominal = this.expectedPointsPerCycle;
    const startTs = state.currentStart ?? state.currentPoints[0]?.ts ?? null;
    const lastPointTs = state.currentPoints[state.currentPoints.length - 1]?.ts
      ?? state.lastPoint?.ts
      ?? now;
    const elapsed = startTs != null ? Math.max(0, (lastPointTs ?? now) - startTs) : 0;
    const expectedRaw = startTs != null
      ? Math.max(1, Math.round(elapsed / this.config.pointIntervalMs))
      : Math.max(1, Math.min(points || expectedNominal, expectedNominal));
    const expectedSoFar = Math.min(expectedNominal, expectedRaw);
    const tolerance = Math.max(1, Math.ceil(expectedSoFar * 0.3));
    let status: SamplingHealthStatus = "ok";
    const notes: string[] = [];
    if (!points) {
      status = "warn";
      notes.push("idle_cycle");
    } else if (expectedSoFar >= 3 && points + tolerance < expectedSoFar) {
      status = "warn";
      notes.push("low_points");
    } else if (points > expectedNominal * 1.5) {
      status = "warn";
      notes.push("extended_cycle");
    }
    const closingAt = startTs ? startTs + this.config.cycleDurationMs : null;
    return {
      startedAt: startTs,
      pointsCollected: points,
      expectedPoints: expectedSoFar,
      closingAt,
      status,
      notes,
    };
  }

  private buildWindowSummary(key: SamplingWindowKey, state: SymbolState): SamplingWindowSummary {
    const window = state.windows[key];
    const counts: Record<SamplingHealthStatus, number> = { ok: 0, warn: 0, error: 0 };
    for (const mark of window) {
      counts[mark.health.status] += 1;
    }
    const cfg = this.config.windows[key];
    return {
      key,
      capacity: cfg?.capacity ?? window.length,
      size: window.length,
      marks: [...window],
      statusCounts: counts,
    };
  }
}

declare global {
   
  var __STR_AUX_SAMPLING_STORE__: SamplingStore | undefined;
}

export function getSamplingStore(config?: SamplerConfig): SamplingStore {
  if (!(globalThis as any).__STR_AUX_SAMPLING_STORE__) {
    (globalThis as any).__STR_AUX_SAMPLING_STORE__ = new SamplingStore(config ?? DEFAULT_SAMPLER_CONFIG);
  }
  return (globalThis as any).__STR_AUX_SAMPLING_STORE__!;
}
