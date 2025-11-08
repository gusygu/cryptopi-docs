import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import {
  listShiftStores,
  peekShiftStore,
  type ShiftStore,
} from '@/core/features/str-aux/frame/shiftStore';

const FRESHNESS_MS = 3 * 60 * 1000; // 3 minutes

const normalizeSymbolInput = (raw: string): string | null => {
  const cleaned = String(raw ?? '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (!cleaned) return null;
  if (cleaned.length < 5 || cleaned.length > 20) return null;
  return cleaned;
};

const toNumberOrNull = (value: unknown): number | null => {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
};

const emptyShiftStore = (): ShiftStore => ({
  window: { exceed: [], counts: [], shifts: 0, streak: 0, totalCycles: 0 },
  streams: { maxStamps: 64 },
  uiEpoch: 0,
  shifts: 0,
});

type ShiftHealthItem = {
  symbol: string;
  sessionId: string;
  initialized: boolean;
  lastUpdatedTs: number | null;
  freshnessMs: number | null;
  gfm: {
    opening: number | null;
    reference: number | null;
    current: number | null;
    deltaPct: number | null;
  };
  params: {
    epsilonPct: number | null;
    windowSize: number | null;
  };
  counters: {
    totalShifts: number;
    streak: number;
    totalCycles: number;
    pendingCycles: number | null;
  };
  status: {
    meetsEpsilon: boolean;
    readyForShift: boolean;
    isFresh: boolean;
  };
  window: {
    counts: number[];
    flags: boolean[];
  };
  lastShift: {
    ts: number | null;
    price: number | null;
    gfm: number | null;
  };
  stamps: Array<{ ts: number; price: number; gfm: number; deltaPct: number }>;
  stampsMax: number | null;
};

function buildHealthItem(
  sessionId: string,
  symbol: string,
  store: ShiftStore,
  initialized: boolean,
  now: number
): ShiftHealthItem {
  const window = store.window ?? { exceed: [], counts: [], streak: 0, totalCycles: 0 };
  const counts = Array.isArray(window.counts) ? window.counts.map((n) => Number(n) || 0) : [];
  const flags = Array.isArray(window.exceed) ? window.exceed.map(Boolean) : [];
  const streak = Number(window.streak ?? 0);
  const totalCycles = Number(window.totalCycles ?? counts.length);
  const epsilonPct = typeof store.epsilonPct === 'number' ? store.epsilonPct : null;
  const windowSize = typeof store.windowSize === 'number' ? store.windowSize : null;
  const deltaPct = Number.isFinite(window.lastDeltaPct ?? NaN) ? (window.lastDeltaPct as number) : null;
  const meetsEpsilon = epsilonPct != null && deltaPct != null ? deltaPct >= epsilonPct : false;
  const readyForShift = windowSize != null ? streak >= windowSize : false;
  const pendingCycles =
    windowSize != null ? Math.max(0, windowSize - streak) : null;
  const lastUpdatedTs = store.lastUpdatedTs ?? null;
  const staleForMs = lastUpdatedTs != null ? now - lastUpdatedTs : null;
  const isFresh = staleForMs != null ? staleForMs <= FRESHNESS_MS : false;

  const lastShift = {
    ts: store.streams?.lastShiftTs ?? null,
    price: toNumberOrNull(store.streams?.lastShiftPrice),
    gfm: toNumberOrNull(store.streams?.lastShiftGfm),
  };

  const stamps = Array.isArray(store.streams?.stamps)
    ? store.streams!.stamps!.map((stamp) => ({
        ts: stamp.ts,
        price: stamp.price,
        gfm: stamp.gfm,
        deltaPct: stamp.deltaPct,
      }))
    : [];

  return {
    symbol,
    sessionId,
    initialized,
    lastUpdatedTs,
    freshnessMs: staleForMs,
    gfm: {
      opening: toNumberOrNull(store.openingGfm),
      reference: toNumberOrNull(store.refGfm),
      current: toNumberOrNull(store.latestGfm),
      deltaPct,
    },
    params: {
      epsilonPct,
      windowSize,
    },
    counters: {
      totalShifts: Number(store.shifts ?? 0),
      streak,
      totalCycles,
      pendingCycles,
    },
    status: {
      meetsEpsilon,
      readyForShift,
      isFresh,
    },
    window: {
      counts,
      flags,
    },
    lastShift,
    stamps,
    stampsMax: toNumberOrNull(store.streams?.maxStamps),
  };
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const sessionParam = url.searchParams.get('sessionId');
    const sessionId = sessionParam ? sessionParam.slice(0, 64) : null;
    const symbolsParam = url.searchParams.get('symbols');
    const now = Date.now();

    const list: string[] | null = symbolsParam && symbolsParam.trim()
      ? Array.from(
          new Set(
            symbolsParam
              .split(',')
              .map((s) => normalizeSymbolInput(s))
              .filter((s): s is string => Boolean(s))
          )
        )
      : null;

    const items: ShiftHealthItem[] = [];

    const sessionFilter = sessionId ?? undefined;
    const allStores = sessionId ? undefined : listShiftStores();

    if (list && list.length) {
      for (const symbol of list) {
        let existing: ShiftStore | undefined;
        if (sessionId) {
          existing = peekShiftStore(sessionId, symbol);
        } else {
          const found = allStores?.find((entry) => entry.symbol === symbol);
          if (found) {
            existing = found.store;
          }
        }
        const store = existing ?? emptyShiftStore();
        const sess =
          sessionId ??
          (existing
            ? allStores?.find((entry) => entry.store === existing)?.sessionId ?? 'ui'
            : 'ui');
        items.push(buildHealthItem(sess, symbol, store, Boolean(existing), now));
      }
    } else {
      const existingStores = sessionFilter ? listShiftStores(sessionFilter) : (allStores ?? []);
      for (const entry of existingStores) {
        items.push(buildHealthItem(entry.sessionId, entry.symbol, entry.store, true, now));
      }
    }

    items.sort((a, b) => a.symbol.localeCompare(b.symbol));

    return NextResponse.json({
      ok: true,
      sessionId,
      ts: now,
      total: items.length,
      items,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err ?? 'unknown_error');
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
