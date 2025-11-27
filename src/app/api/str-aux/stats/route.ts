// src/app/api/str-aux/stats/route.ts
import { NextResponse } from 'next/server';
import { requireUserSession } from '@/app/(server)/auth/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import { computeSampledMetricsForSymbol, type SampledMetricsResult } from '@/core/features/str-aux/calc/panel';
import { applyGfmShiftAndStreams, type ShiftWindowState, type StreamsState } from '@/core/features/str-aux/frame/analytics';
import type { SamplingWindowKey } from '@/core/features/str-aux/sampling';
import type { StatsOptions } from '@/core/features/str-aux/calc/stats';
import { resolveSymbolSelection } from '@/core/features/str-aux/symbols';

type WindowKey = SamplingWindowKey;

function parseWindow(s: string | null | undefined): WindowKey {
  const v = (s ?? '30m').toLowerCase();
  return (v === '30m' || v === '1h' || v === '3h') ? (v as WindowKey) : '30m';
}
function parseBinsParam(s: string | null | undefined, dflt = 128) {
  const n = Number(s ?? dflt);
  return Number.isFinite(n) && n > 0 ? Math.min(2048, Math.floor(n)) : dflt;
}

async function fetchTicker24h(symbol: string) {
  const r = await fetch(`https://api.binance.com/api/v3/ticker/24hr?symbol=${symbol}`, { cache: 'no-store' });
  if (!r.ok) return { price: NaN, pct24h: NaN };
  const j = await r.json() as any;
  const price = Number(j.lastPrice ?? j.weightedAvgPrice ?? NaN);
  const pct24h = Number(j.priceChangePercent ?? NaN);
  return { price, pct24h };
}

function pctDrv(prev: number, cur: number): number { return 100 * ((cur / prev) - 1); }

function disruptionFromCounts(counts: number[]): number | null {
  if (!Array.isArray(counts) || counts.length === 0) return null;
  let total = 0;
  for (let i = 1; i < counts.length; i++) {
    total += Math.abs((Number(counts[i]) || 0) - (Number(counts[i - 1]) || 0));
  }
  return counts.length ? total / counts.length : null;
}

type ShiftStore = {
  refGfm01: number;
  window: ShiftWindowState;
  streams: StreamsState;
  uiEpoch: number;
  shifts: number;
};
declare global { var __STR_AUX_SHIFT__: Map<string, ShiftStore> | undefined; }
const SHIFT: Map<string, ShiftStore> = (globalThis as any).__STR_AUX_SHIFT__ ?? new Map();
(globalThis as any).__STR_AUX_SHIFT__ = SHIFT;
const shiftKey = (sess: string, sym: string) => `${sess}:${sym}`;
function getShiftState(appSessionId: string, symbol: string): ShiftStore {
  const key = shiftKey(appSessionId, symbol);
  const cur = SHIFT.get(key);
  if (cur) {
    if (!cur.streams) cur.streams = { maxStamps: 64 };
    return cur;
  }
  const init: ShiftStore = {
    refGfm01: 0.5,
    window: { exceed: [], shifts: 0 },
    streams: { maxStamps: 64 },
    uiEpoch: 0,
    shifts: 0,
  };
  SHIFT.set(key, init);
  return init;
}

const toNullable = (value: unknown): number | null =>
  Number.isFinite(value as number) ? (value as number) : null;

type StreamScalar = { prev: number | null; cur: number | null; greatest: number | null };
const updateStreamScalar = (row: StreamScalar | undefined, next: number | null): StreamScalar | undefined => {
  if (next === null || !Number.isFinite(next)) return row;
  const prevCur = Number.isFinite(row?.cur ?? NaN) ? row!.cur! : null;
  const prevGreatest = Number.isFinite(row?.greatest ?? NaN) ? Math.abs(row!.greatest!) : 0;
  const greatest = Math.max(prevGreatest, Math.abs(next));
  return { prev: prevCur, cur: next, greatest: greatest > 0 ? greatest : null };
};

export async function GET(req: Request) {
  await requireUserSession();
  try {
    const url = new URL(req.url);
    const selection = await resolveSymbolSelection(url);
    const symbols = selection.symbols;
    const windowKey = parseWindow(url.searchParams.get('window'));
    const binsN = parseBinsParam(url.searchParams.get('bins'), 256);
    const appSessionId = (url.searchParams.get('sessionId') ?? 'ui').slice(0, 64);
    const epsPct = Number(url.searchParams.get('eps') ?? '0.35');
    const kCycles = Math.max(1, Math.floor(Number(url.searchParams.get('k') ?? '5')));
    const now = Date.now();

    if (!symbols.length) {
      return NextResponse.json({ ok: true, symbols: [], out: {}, window: windowKey, ts: now });
    }

    const baseStatsOptions: StatsOptions = {
      idhr: { alpha: 2.5, sMin: 1e-6, smooth: 3, topK: 8 },
      epsGfmPct: epsPct,
      epsBfmPct: epsPct,
      vScale: 100,
      tendencyWin: 30,
      tendencyNorm: 'mad',
    };

    const out: Record<string, any> = {};

    for (const symbol of symbols) {
      let metrics: SampledMetricsResult | null = null;
      try {
        const store = getShiftState(appSessionId, symbol);
        const statsOptions: StatsOptions = {
          ...baseStatsOptions,
          idhr: { ...(baseStatsOptions.idhr ?? {}), topK: baseStatsOptions.idhr?.topK ?? 8 },
        };
        const [met, t24] = await Promise.all([
          computeSampledMetricsForSymbol(symbol, { window: windowKey, bins: binsN, stats: statsOptions }),
          fetchTicker24h(symbol),
        ]);
        metrics = met;

        if (!metrics.ok) {
          out[symbol] = {
            ok: false,
            error: metrics.error,
            bins: binsN,
            window: windowKey,
            sampling: metrics.sampling,
          };
          continue;
        }

        const stats = metrics.stats;
        const { meta, sampling, hist, extrema } = metrics;
        const ap = applyGfmShiftAndStreams(
          stats.bfm01,
          store.refGfm01,
          store.window,
          store.streams,
          { epsilonPct: epsPct, windowSize: kCycles, nowTs: meta.lastUpdateTs, price: meta.last },
        );
        store.window = ap.window;
        store.streams = ap.streams;
        if (ap.isShift) {
          store.refGfm01 = stats.bfm01;
          store.uiEpoch += 1;
          store.shifts += 1;
        }

        const inertiaTotal = toNullable(stats.inertia?.total);
        const inertiaStaticVal = toNullable(stats.inertia?.static);
        const inertiaGrowthVal = toNullable(stats.inertia?.growth);

        const ampVal = toNullable(stats.amp);
        const voltVal = toNullable(stats.volt);
        const efficiencyVal = toNullable(stats.efficiency);

        store.streams.inertia = updateStreamScalar(store.streams.inertia, inertiaTotal);
        store.streams.amp = updateStreamScalar(store.streams.amp, ampVal);
        store.streams.volt = updateStreamScalar(store.streams.volt, voltVal);
        store.streams.efficiency = updateStreamScalar(store.streams.efficiency, efficiencyVal);

        const pct24hVal = Number.isFinite(t24.pct24h) ? t24.pct24h : null;
        const pctDrvVal =
          meta.n > 1 &&
          Number.isFinite(meta.prev) &&
          Number.isFinite(meta.last) &&
          meta.prev !== 0
            ? pctDrv(meta.prev, meta.last)
            : null;

        store.streams.pct24h = updateStreamScalar(store.streams.pct24h, pct24hVal);
        store.streams.pct_drv = updateStreamScalar(store.streams.pct_drv, pctDrvVal);

        const histCountsForDisruption = Array.isArray(stats.histogram?.counts) && stats.histogram!.counts.length
          ? stats.histogram!.counts.map((c: any) => Number(c) || 0)
          : Array.isArray(hist.counts) ? hist.counts.map((c: any) => Number(c) || 0) : [];
        const disruptionVal = disruptionFromCounts(histCountsForDisruption);

        const gfmAbsVal = toNullable(stats.gfmAbs);
        const gfmRefVal = toNullable(stats.refGfmAbs);
        const deltaGfmAbsVal = toNullable(stats.deltaGfmAbs);
        const deltaGfmPctVal = toNullable(stats.deltaGfmPct);

        const bfmVal = toNullable(stats.bfm01);
        const bfmRefVal = toNullable(stats.refBfm01);
        const deltaBfmVal = toNullable(stats.deltaBfm01);
        const deltaBfmPctVal = toNullable(stats.deltaBfmPct);

        const sigmaVal = toNullable(stats.sigma);
        const zAbsVal = toNullable(stats.zAbs);

        const openingVal = toNullable(stats.opening);
        const lastVal = toNullable(stats.last);
        const prevVal = toNullable(stats.prev);

        store.streams.benchmark = updateStreamScalar(store.streams.benchmark, lastVal);

        const inertiaOut = stats.inertia
          ? {
              static: inertiaStaticVal,
              growth: inertiaGrowthVal,
              total: inertiaTotal,
              face: stats.inertia.face ?? null,
            }
          : null;

        const metricsOut = {
          dispersion: { sigma: sigmaVal, zAbs: zAbsVal },
          gfm: {
            absolute: gfmAbsVal,
            reference: gfmRefVal,
            deltaAbs: deltaGfmAbsVal,
            deltaPct: deltaGfmPctVal,
            shifted: Boolean(stats.shiftedGfm),
          },
          bfm: {
            value: bfmVal,
            reference: bfmRefVal,
            delta: deltaBfmVal,
            deltaPct: deltaBfmPctVal,
            shifted: Boolean(stats.shiftedBfm),
          },
          intrinsic: {
            inertia: inertiaOut,
            amp: ampVal,
            volt: voltVal,
            efficiency: efficiencyVal,
          },
          disruption: disruptionVal,
        };

        const statsOut = {
          sigma: sigmaVal,
          zAbs: zAbsVal,
          gfmAbs: gfmAbsVal,
          refGfmAbs: gfmRefVal,
          deltaGfmAbs: deltaGfmAbsVal,
          deltaGfmPct: deltaGfmPctVal,
          shiftedGfm: Boolean(stats.shiftedGfm),
          bfm01: bfmVal,
          refBfm01: bfmRefVal,
          deltaBfm01: deltaBfmVal,
          deltaBfmPct: deltaBfmPctVal,
          shiftedBfm: Boolean(stats.shiftedBfm),
          inertia: inertiaOut,
          amp: ampVal,
          volt: voltVal,
          efficiency: efficiencyVal,
          histogram: stats.histogram ?? null,
          opening: openingVal,
          last: lastVal,
          prev: prevVal,
        };

        const gfmDelta = {
          anchorPrice: gfmAbsVal,
          price: lastVal,
          absPct: deltaGfmPctVal,
        };

        out[symbol] = {
          ok: true,
          window: windowKey,
          n: meta.n,
          cards: {
            opening: { benchmark: openingVal, pct24h: pct24hVal },
            live: { benchmark: lastVal, pct_drv: pctDrvVal, pct24h: pct24hVal },
          },
          stats: statsOut,
          metrics: metricsOut,
          fm: {
            gfm: gfmAbsVal,
            gfm_price: gfmAbsVal,
            gfm_calc_price: gfmAbsVal,
            gfm_ref_price: gfmRefVal,
            bfm01: bfmVal,
            bfm_ref: bfmRefVal,
            bfm_delta01: deltaBfmVal,
            bfm_delta_pct: deltaBfmPctVal,
            bfm_shifted: Boolean(stats.shiftedBfm),
            sigma: sigmaVal,
            zAbs: zAbsVal,
            inertia: inertiaTotal,
            disruption: disruptionVal,
            amp: ampVal,
            volt: voltVal,
            efficiency: efficiencyVal,
          },
          gfmDelta,
          streams: store.streams,
          shifts: { nShifts: store.shifts, latestTs: meta.lastUpdateTs },
          shift_stamp: ap.isShift,
          hist,
          extrema,
          meta: { uiEpoch: store.uiEpoch, epsPct, kCycles },
          lastUpdateTs: meta.lastUpdateTs,
          sampling,
        };
      } catch (e: any) {
        const sampling = metrics && 'sampling' in metrics ? metrics.sampling : undefined;
        out[symbol] = {
          ok: false,
          error: String(e?.message ?? e),
          window: windowKey,
          bins: binsN,
          sampling,
        };
      }
    }

    return NextResponse.json({
      ok: true,
      symbols,
      out,
      window: windowKey,
      ts: now,
      universe: {
        quote: selection.quote,
        quotes: selection.quotes,
        bases: selection.bases,
        defaults: selection.defaults,
        extras: selection.extras,
        explicit: selection.explicit,
        source: selection.source,
      },
    });
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: String(err?.message ?? err) }, { status: 500 });
  }
}
