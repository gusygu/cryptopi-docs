import type { ShiftWindowState, StreamsState } from './analytics';

export type ShiftStore = {
  openingGfm?: number;
  refGfm?: number;
  latestGfm?: number;
  window: ShiftWindowState;
  streams: StreamsState;
  uiEpoch: number;
  shifts: number;
  lastUpdatedTs?: number;
  epsilonPct?: number;
  windowSize?: number;
  innerHistScaled?: number[];
  tendencyHistScaled?: number[];
};

type ShiftMap = Map<string, ShiftStore>;

const GLOBAL_KEY = '__STR_AUX_SHIFT__';
const SHIFT: ShiftMap = (globalThis as any)[GLOBAL_KEY] ?? new Map();
(globalThis as any)[GLOBAL_KEY] = SHIFT;

const keyFor = (sessionId: string, symbol: string) => `${sessionId}:${symbol}`;

export function getShiftStore(sessionId: string, symbol: string): ShiftStore {
  const key = keyFor(sessionId, symbol);
  const current = SHIFT.get(key);
  if (current) return current;
  const init: ShiftStore = {
    window: { exceed: [], counts: [], shifts: 0, streak: 0, totalCycles: 0 },
    streams: { maxStamps: 64 },
    uiEpoch: 0,
    shifts: 0,
  };
  SHIFT.set(key, init);
  return init;
}

export function peekShiftStore(sessionId: string, symbol: string): ShiftStore | undefined {
  return SHIFT.get(keyFor(sessionId, symbol));
}

export function listShiftStores(sessionId?: string): Array<{ sessionId: string; symbol: string; store: ShiftStore }> {
  const out: Array<{ sessionId: string; symbol: string; store: ShiftStore }> = [];
  for (const [key, store] of SHIFT.entries()) {
    const idx = key.indexOf(':');
    if (idx <= 0) continue;
    const sess = key.slice(0, idx);
    const symbol = key.slice(idx + 1);
    if (sessionId && sess !== sessionId) continue;
    out.push({ sessionId: sess, symbol, store });
  }
  return out;
}
