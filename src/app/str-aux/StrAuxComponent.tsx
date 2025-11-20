'use client';

import React, { useEffect, useState, useMemo } from 'react';

type Props = {
  symbols?: string[];
  win?: string;
  bins?: number;
  base?: string;
};

type VectorRow = {
  symbol: string;
  window: string;
  bins: number;
  scale?: number;
  samples?: number;
  payload: {
    vInner?: number | null;
    vOuter?: number | null;
    spread?: number | null;
    vTendency?: {
      score?: number | null;
      direction?: number | null;
      strength?: number | null;
      slope?: number | null;
      r?: number | null;
    } | null;
    vSwap?: {
      score?: number | null;
      quartile?: number | null;
      q1?: number | null;
      q3?: number | null;
    };
  };
  created_ts: string;
};

type StatRow = {
  symbol: string;
  window: string;
  payload?: {
    gfm?: number;
    gfm_pct?: number;
    price?: number;
    shift?: number;
    day?: number;
    drv?: number;
    opening?: number;
    min?: number;
    max?: number;
  };
  error?: string | null;
  created_ts: string;
};

export default function StrAuxClient({
  symbols = [],
  win = '30m',
  bins = 128,
  base = '/api/str-aux',
}: Props) {
  const symArr = useMemo(() => symbols, [symbols]);
  const symbolsCsv = useMemo(() => symArr.join(','), [symArr]);
  const symbolsQuery = symbolsCsv ? `&symbols=${encodeURIComponent(symbolsCsv)}` : '';
  const [vectors, setVectors] = useState<Record<string, VectorRow>>({});
  const [stats, setStats] = useState<Record<string, StatRow>>({});
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    const vecUrl = `${base}/vectors?window=${encodeURIComponent(win)}&bins=${bins}${symbolsQuery}`;
    const staUrl = `${base}/stats?window=${encodeURIComponent(win)}&bins=${bins}${symbolsQuery}`;
    setLoading(true);
    setErrorMsg(null);

    Promise.all([fetch(vecUrl), fetch(staUrl)])
      .then(async ([vRes, sRes]) => {
        if (!vRes.ok) throw new Error(`vectors ${vRes.status}`);
        if (!sRes.ok) throw new Error(`stats ${sRes.status}`);
        const vJson = await vRes.json();
        const sJson = await sRes.json();

        const vData: Record<string, VectorRow> = {};
        const sData: Record<string, StatRow> = {};

        normalizeVectorRows(vJson, win, bins).forEach((row) => {
          if (row?.symbol) vData[row.symbol] = row;
        });
        normalizeStatRows(sJson, win).forEach((row) => {
          if (row?.symbol) sData[row.symbol] = row;
        });

        setVectors(vData);
        setStats(sData);
      })
      .catch((e: any) => setErrorMsg(e.message || 'Error loading data'))
      .finally(() => setLoading(false));
  }, [win, bins, base, symbolsQuery]);

  const symbolsList = symArr.length ? symArr : Object.keys({ ...vectors, ...stats });

  return (
    <div className="p-4 text-gray-100">
      <h2 className="text-xl font-semibold mb-2">Str-Aux</h2>
      <div className="text-sm opacity-70 mb-4">
        Window: {win} • Bins: {bins} • Symbols: {symbolsList.join(', ') || '—'}
      </div>

      {loading && <div className="opacity-70">Loading…</div>}
      {errorMsg && <div className="text-red-400">Error: {errorMsg}</div>}

      <div className="grid gap-4 grid-cols-[repeat(auto-fit,minmax(300px,1fr))]">
        {symbolsList.map((sym) => {
          const v = vectors[sym];
          const s = stats[sym];
          const payload = s?.payload || {};
          const statError = s?.error ?? null;
          const vec = v?.payload || {};

          return (
            <div
              key={sym}
              className="rounded-2xl p-4 border border-indigo-500/30 bg-[#0d0d15] shadow-sm flex flex-col justify-between"
            >
              <div className="flex justify-between items-center mb-2">
                <div className="font-semibold text-base">{sym}</div>
                <div className="text-xs opacity-60">
                  {win} • {bins ? `${bins} pts` : ''}
                </div>
              </div>

              <div className="space-y-1 text-sm">
                {statError ? (
                  <div className="text-xs text-amber-400">
                    {describeStatsError(statError, win)}
                  </div>
                ) : (
                  <>
                    <div className="flex justify-between">
                      <span className="opacity-70">GFM</span>
                      <span>
                        {payload.gfm?.toFixed(3) ?? '-'} ({(payload.gfm_pct ?? 0).toFixed(2)}%)
                      </span>
                    </div>

                    <div className="flex justify-between">
                      <span className="opacity-70">price</span>
                      <span>{payload.price?.toFixed(6) ?? '-'}</span>
                    </div>

                    <div className="flex justify-between">
                      <span className="opacity-70">24h</span>
                      <span>{payload.day?.toFixed(2) ?? '-'}%</span>
                    </div>

                    <div className="flex justify-between">
                      <span className="opacity-70">drv</span>
                      <span>{payload.drv?.toFixed(3) ?? '-'}</span>
                    </div>

                    <div className="flex justify-between">
                      <span className="opacity-70">opening</span>
                      <span>{payload.opening?.toFixed(6) ?? '-'}</span>
                    </div>

                    <div className="flex justify-between">
                      <span className="opacity-70">min</span>
                      <span>{payload.min?.toFixed(6) ?? '-'}</span>
                    </div>

                    <div className="flex justify-between">
                      <span className="opacity-70">max</span>
                      <span>{payload.max?.toFixed(6) ?? '-'}</span>
                    </div>
                  </>
                )}

                <hr className="border-indigo-900/30 my-2" />

                <div className="flex justify-between">
                  <span className="opacity-70">vInner</span>
                  <span>{vec.vInner ?? '-'}</span>
                </div>

                <div className="flex justify-between">
                  <span className="opacity-70">vOuter</span>
                  <span>{vec.vOuter ?? '—'}</span>
                </div>

                <div className="flex justify-between">
                  <span className="opacity-70">spread</span>
                  <span>{vec.spread ?? '-'}</span>
                </div>

                <div className="flex justify-between text-xs opacity-60">
                  <span>samples</span>
                  <span>{v?.samples ?? '-'}</span>
                </div>

                {vec.vTendency && (
                  <div className="text-xs mt-1 opacity-70">
                    tendency: dir {vec.vTendency.direction}, slope {vec.vTendency.slope}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

const toNumberOrNull = (value: unknown): number | null => {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};

function normalizeVectorRows(data: any, win: string, bins: number): VectorRow[] {
  if (!data) return [];
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.vectors)) return data.vectors;
  if (data?.vectors && typeof data.vectors === 'object') {
    return Object.entries(data.vectors).map(([symbol, entry]: [string, any]) => {
      const samplesValue =
        typeof entry?.samples === 'number'
          ? Number(entry.samples)
          : typeof entry?.summary?.samples === 'number'
          ? Number(entry.summary.samples)
          : undefined;
      return {
        symbol,
        window: entry?.window ?? data.window ?? win,
        bins: Number(entry?.bins ?? data.bins ?? bins),
        scale: entry?.scale ?? data.scale,
        samples: samplesValue,
        payload: entry?.payload ?? coerceVectorPayload(entry),
        created_ts: entry?.created_ts ?? new Date().toISOString(),
      };
    });
  }
  return [];
}

function coerceVectorPayload(entry: any): VectorRow['payload'] {
  const summary = entry?.summary ?? {};
  const metrics = summary?.tendency?.metrics ?? entry?.vTendency ?? {};
  const payload: VectorRow['payload'] = {
    vInner: toNumberOrNull(entry?.vInner ?? summary?.inner?.scaled),
    vOuter: toNumberOrNull(entry?.vOuter ?? summary?.outer?.scaled),
    spread: toNumberOrNull(entry?.spread),
    vTendency: entry?.vTendency ?? {
      score: toNumberOrNull(metrics?.score),
      direction: toNumberOrNull(metrics?.direction),
      strength: toNumberOrNull(metrics?.strength),
      slope: toNumberOrNull(metrics?.slope),
      r: toNumberOrNull(metrics?.r),
    },
    vSwap: entry?.vSwap ?? (summary?.swap
      ? {
          score: toNumberOrNull(summary.swap?.score),
          quartile: toNumberOrNull(summary.swap?.Q),
          q1: toNumberOrNull(summary.swap?.q1),
          q3: toNumberOrNull(summary.swap?.q3),
        }
      : undefined),
  };
  if (
    payload.vTendency &&
    payload.vTendency.score == null &&
    payload.vTendency.direction == null &&
    payload.vTendency.strength == null &&
    payload.vTendency.slope == null &&
    payload.vTendency.r == null
  ) {
    payload.vTendency = null;
  }
  return payload;
}

function normalizeStatRows(data: any, win: string): StatRow[] {
  if (!data) return [];
  if (Array.isArray(data?.stats)) return data.stats;
  const out = data?.out;
  if (!out || typeof out !== 'object') return [];
  const rows: StatRow[] = [];
  for (const [symbol, entry] of Object.entries(out)) {
    if (!entry || typeof entry !== 'object') continue;
    const error = typeof (entry as any)?.error === 'string' ? String((entry as any).error) : null;
    const payload =
      error && !(entry as any).payload
        ? undefined
        : (entry as any).payload ?? {
            gfm: toNumberOrNull((entry as any)?.fm?.gfm_price ?? (entry as any)?.fm?.gfm_calc_price),
            gfm_pct: toNumberOrNull((entry as any)?.gfmDelta?.absPct),
            price: toNumberOrNull((entry as any)?.cards?.live?.benchmark),
            shift: toNumberOrNull((entry as any)?.shifts ?? (entry as any)?.shift_stamp),
            day: toNumberOrNull((entry as any)?.cards?.live?.pct24h),
            drv: toNumberOrNull((entry as any)?.streams?.pct_drv?.cur),
            opening: toNumberOrNull((entry as any)?.cards?.opening?.benchmark),
            min: toNumberOrNull((entry as any)?.sessionStats?.priceMin),
            max: toNumberOrNull((entry as any)?.sessionStats?.priceMax),
          };
    rows.push({
      symbol,
      window: (entry as any)?.window ?? data.window ?? win,
      payload,
      error,
      created_ts: new Date(Number((entry as any)?.lastUpdateTs ?? data.ts ?? Date.now())).toISOString(),
    });
  }
  return rows;
}

function describeStatsError(error: string, windowKey: string) {
  if (!error) return '';
  if (error === 'insufficient_window') {
    return `Waiting for a full ${windowKey} sampling window.`;
  }
  if (error === 'no_points') {
    return 'No recent sampling points yet.';
  }
  return error;
}
