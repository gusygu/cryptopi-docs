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
  payload: {
    vInner?: number;
    vOuter?: number;
    spread?: number;
    vTendency?: {
      score?: number;
      direction?: number;
      strength?: number;
      slope?: number;
      r?: number;
    };
  };
  created_ts: string;
};

type StatRow = {
  symbol: string;
  window: string;
  payload: {
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
  created_ts: string;
};

export default function StrAuxClient({
  symbols = [],
  win = '30m',
  bins = 128,
  base = '/api/str-aux',
}: Props) {
  const symArr = useMemo(() => symbols, [symbols]);
  const [vectors, setVectors] = useState<Record<string, VectorRow>>({});
  const [stats, setStats] = useState<Record<string, StatRow>>({});
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    const vecUrl = `${base}/vectors?window=${encodeURIComponent(win)}`;
    const staUrl = `${base}/stats?window=${encodeURIComponent(win)}`;
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

        (vJson?.vectors || []).forEach((r: VectorRow) => (vData[r.symbol] = r));
        (sJson?.stats || []).forEach((r: StatRow) => (sData[r.symbol] = r));

        setVectors(vData);
        setStats(sData);
      })
      .catch((e: any) => setErrorMsg(e.message || 'Error loading data'))
      .finally(() => setLoading(false));
  }, [win, bins, base]);

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
                <div className="flex justify-between">
                  <span className="opacity-70">GFM</span>
                  <span>{payload.gfm?.toFixed(3) ?? '—'} ({(payload.gfm_pct ?? 0).toFixed(2)}%)</span>
                </div>

                <div className="flex justify-between">
                  <span className="opacity-70">price</span>
                  <span>{payload.price?.toFixed(6) ?? '—'}</span>
                </div>

                <div className="flex justify-between">
                  <span className="opacity-70">24h</span>
                  <span>{payload.day?.toFixed(2) ?? '—'}%</span>
                </div>

                <div className="flex justify-between">
                  <span className="opacity-70">drv</span>
                  <span>{payload.drv?.toFixed(3) ?? '—'}</span>
                </div>

                <div className="flex justify-between">
                  <span className="opacity-70">opening</span>
                  <span>{payload.opening?.toFixed(6) ?? '—'}</span>
                </div>

                <div className="flex justify-between">
                  <span className="opacity-70">min</span>
                  <span>{payload.min?.toFixed(6) ?? '—'}</span>
                </div>

                <div className="flex justify-between">
                  <span className="opacity-70">max</span>
                  <span>{payload.max?.toFixed(6) ?? '—'}</span>
                </div>

                <hr className="border-indigo-900/30 my-2" />

                <div className="flex justify-between">
                  <span className="opacity-70">vInner</span>
                  <span>{vec.vInner ?? '—'}</span>
                </div>

                <div className="flex justify-between">
                  <span className="opacity-70">vOuter</span>
                  <span>{vec.vOuter ?? '—'}</span>
                </div>

                <div className="flex justify-between">
                  <span className="opacity-70">spread</span>
                  <span>{vec.spread ?? '—'}</span>
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
