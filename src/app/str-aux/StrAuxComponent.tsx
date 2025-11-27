'use client';

import React, { useEffect, useMemo, useState } from 'react';
import Histogram from "@/components/features/str-aux/Histogram";

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

export default function StrAuxClient({
  symbols = [],
  win = '30m',
  bins = 256,
  base = '/api/str-aux',
}: Props) {
  const symbolsCsv = useMemo(() => symbols.join(','), [symbols]);
  const symbolsQuery = symbolsCsv ? `&symbols=${encodeURIComponent(symbolsCsv)}` : '';
  const [vectors, setVectors] = useState<Record<string, VectorRow>>({});
  const [stats, setStats] = useState<Record<string, any>>({});
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [storeReady, setStoreReady] = useState(false);
  const [page, setPage] = useState(0);

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
        normalizeVectorRows(vJson, win, bins).forEach((row) => {
          if (row?.symbol) vData[row.symbol] = row;
        });

        const sOut = sJson?.out && typeof sJson.out === 'object' ? (sJson.out as Record<string, any>) : {};

        setVectors(vData);
        setStats(sOut);
        setStoreReady(true);
      })
      .catch((e: any) => setErrorMsg(e.message || 'Error loading data'))
      .finally(() => setLoading(false));
  }, [win, bins, base, symbolsQuery]);

  const symbolsList = symbols.length ? symbols : Object.keys({ ...vectors, ...stats });
  const pageSize = 9;
  const pages = Math.max(1, Math.ceil(symbolsList.length / pageSize));
  const clampedPage = Math.min(page, pages - 1);
  const visibleSymbols = symbolsList.slice(clampedPage * pageSize, clampedPage * pageSize + pageSize);

  return (
    <div className="p-4 text-gray-100">
      <h2 className="text-xl font-semibold mb-2">Str-Aux Dashboard</h2>
      <div className="text-sm opacity-80 mb-4 flex flex-wrap gap-6 items-center justify-between">
        <div className="flex flex-wrap gap-6">
          <div>Window: {win}</div>
          <div>Bins: {bins}</div>
          <div>Symbols: {symbolsList.length || '-'}</div>
        </div>
        {pages > 1 && (
          <div className="flex items-center gap-2 text-sm">
            <button
              disabled={clampedPage === 0}
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              className="px-2 py-1 rounded-lg border border-indigo-500/40 disabled:opacity-40"
            >
              Prev
            </button>
            <span>
              Page {clampedPage + 1} / {pages}
            </span>
            <button
              disabled={clampedPage >= pages - 1}
              onClick={() => setPage((p) => Math.min(pages - 1, p + 1))}
              className="px-2 py-1 rounded-lg border border-indigo-500/40 disabled:opacity-40"
            >
              Next
            </button>
          </div>
        )}
      </div>

      {loading && <div className="opacity-70">Loading…</div>}
      {errorMsg && <div className="text-amber-400">{errorMsg}</div>}

      {!loading && !errorMsg && (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {visibleSymbols.map((sym) => (
            <div key={sym} className="rounded-2xl p-4 border border-indigo-500/30 bg-[#0d0d15] shadow-sm">
              {renderHeaderSection(sym, stats[sym], vectors[sym], storeReady, win)}
              {renderMetricsSection(stats[sym])}
              <div className="mt-3 border-t border-indigo-900/30 pt-3">{renderVectorSection(vectors[sym])}</div>
              {(() => {
                const streams = resolveStreams(stats[sym]);
                if (!streams.length) return null;
                return (
                  <div className="mt-3">
                    <h4 className="text-xs uppercase tracking-wide text-indigo-200/80 mb-2">Streams</h4>
                    <div className="max-h-36 overflow-y-auto border border-indigo-900/30 rounded-lg">
                      <table className="w-full text-xs">
                        <tbody>
                          {streams.map((row) => (
                            <tr key={row.key} className="text-indigo-200/90 border-b border-indigo-900/20 last:border-b-0">
                              <td className="py-1 px-2 opacity-70">{row.label}</td>
                              <td className="py-1 px-2 text-right">{formatMaybe(row.prev)}</td>
                              <td className="py-1 px-2 text-right">{formatMaybe(row.cur)}</td>
                              <td className="py-1 px-2 text-right">{formatMaybe(row.greatest)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                );
              })()}

              <HistogramSections
                statsEntry={stats[sym]}
                vectorRow={vectors[sym]}
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function renderHeaderSection(
  symbol: string,
  statsEntry: any,
  vectorsEntry: VectorRow | undefined,
  storeReady: boolean,
  windowKey: string
) {
  if (!statsEntry && !vectorsEntry) {
    return <div className="text-sm text-amber-400">No data available for {symbol}.</div>;
  }

  const error = statsEntry?.error ?? null;
  const lastTs = statsEntry?.lastUpdateTs ?? statsEntry?.meta?.lastUpdateTs ?? null;
  const lastUpdate = lastTs ? new Date(Number(lastTs)).toLocaleTimeString() : 'n/a';
  const shiftInfo = statsEntry?.shifts ?? {};
  const samples = vectorsEntry?.samples ?? '-';

  return (
    <div className="flex flex-wrap gap-6 mb-6 items-center justify-between">
      <div>
        <div className="text-lg font-semibold">{symbol}</div>
        <div className="text-xs uppercase tracking-wide opacity-70">Window {windowKey}</div>
      </div>
      <div className="flex gap-6 text-sm">
        <div>
          <div className="text-xs uppercase opacity-70">Last update</div>
          <div>{lastUpdate}</div>
        </div>
        <div>
          <div className="text-xs uppercase opacity-70">Shifts</div>
          <div>{shiftInfo?.nShifts ?? 0}</div>
        </div>
        <div>
          <div className="text-xs uppercase opacity-70">Samples</div>
          <div>{samples}</div>
        </div>
        <div>
          <div className="text-xs uppercase opacity-70">Sampler</div>
          <div>{storeReady ? 'running' : 'warming'}</div>
        </div>
      </div>
      {error && (
        <div className="text-amber-400 text-sm w-full">{describeStatsError(error, windowKey)}</div>
      )}
    </div>
  );
}

function renderMetricsSection(statsEntry: any) {
  if (!statsEntry) {
    return <div className="text-sm text-amber-400">Waiting for stats.</div>;
  }

  const cards = statsEntry.cards ?? {};
  const stats = statsEntry.stats ?? {};
  const gfm = stats?.gfmAbs ?? statsEntry.gfmDelta?.anchorPrice;
  const gfmPct = statsEntry.gfmDelta?.absPct ?? stats?.deltaGfmPct;
  const price = cards?.live?.benchmark ?? stats?.last;
  const pctDrv = cards?.live?.pct_drv ?? statsEntry?.streams?.pct_drv?.cur;
  const opening = cards?.opening?.benchmark ?? stats?.opening;
  const ranges = statsEntry.sessionStats ?? statsEntry.extrema ?? {};
  const bfm = stats?.bfm01 ?? statsEntry?.stats?.bfm01;
  const refBfm = stats?.refBfm01;
  const deltaBfm = stats?.deltaBfmPct ?? (stats?.deltaBfm01 != null ? stats.deltaBfm01 * 100 : null);

  const metricDefs = [
    { label: 'GFM', value: formatMaybe(gfm), hint: `${formatMaybe(gfmPct, 2)}%` },
    { label: 'BFM', value: formatMaybe(bfm, 3), hint: `ref ${formatMaybe(refBfm, 3)} (${formatMaybe(deltaBfm, 2)}%)` },
    { label: 'Benchmark', value: formatMaybe(price), hint: `${formatMaybe(cards?.live?.pct24h, 2)}% 24h` },
    { label: 'Drv', value: formatMaybe(pctDrv, 3), hint: 'session drift' },
    { label: 'Opening', value: formatMaybe(opening), hint: 'session' },
    { label: 'Min', value: formatMaybe(ranges.priceMin ?? ranges.benchPctMin, 4), hint: 'session low' },
    { label: 'Max', value: formatMaybe(ranges.priceMax ?? ranges.benchPctMax, 4), hint: 'session high' },
  ];

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 text-sm">
      {metricDefs.map((def) => (
        <MetricCard key={def.label} label={def.label} value={def.value} hint={def.hint} />
      ))}
    </div>
  );
}

function MetricCard({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="bg-[#060612] rounded-xl p-3 border border-indigo-500/20">
      <div className="text-xs uppercase tracking-wide opacity-70">{label}</div>
      <div className="text-lg font-semibold text-indigo-100">{value}</div>
      {hint && <div className="text-xs text-indigo-300/80 mt-1">{hint}</div>}
    </div>
  );
}

function renderVectorSection(vectorRow?: VectorRow) {
  if (!vectorRow) return <div className="text-sm text-amber-400">No vector snapshot yet.</div>;
  const vec = vectorRow.payload ?? {};
  return (
    <>
      <h3 className="font-semibold mb-3">Vectors</h3>
      <div className="grid gap-4 md:grid-cols-2 text-sm">
        <div className="space-y-2">
          <VectorMetric label="vInner" value={vec.vInner} />
          <VectorMetric label="vOuter" value={vec.vOuter} />
          <VectorMetric label="Spread" value={vec.spread} />
        </div>
        <div className="space-y-2">
          <VectorMetric label="vSwap score" value={vec.vSwap?.score} />
          <VectorMetric label="vSwap quartile" value={vec.vSwap?.quartile} />
          <VectorMetric label="Samples" value={vectorRow.samples} />
        </div>
      </div>
      {vec.vTendency && (
        <div className="mt-4 text-xs text-indigo-200/80 grid gap-1 md:grid-cols-3">
          <div>
            <span className="opacity-70 mr-2">Tendency score:</span>
            {formatMaybe(vec.vTendency.score)}
          </div>
          <div>
            <span className="opacity-70 mr-2">Direction:</span>
            {formatMaybe(vec.vTendency.direction)}
          </div>
          <div>
            <span className="opacity-70 mr-2">Slope:</span>
            {formatMaybe(vec.vTendency.slope)}
          </div>
        </div>
      )}
    </>
  );
}

function VectorMetric({ label, value }: { label: string; value: number | string | null | undefined }) {
  return (
    <div className="flex justify-between">
      <span className="opacity-70">{label}</span>
      <span>{formatMaybe(value)}</span>
    </div>
  );
}

function resolveStreams(entry: any) {
  if (!entry?.streams) return [];
  const rows: Array<{ key: string; label: string; prev?: number | null; cur?: number | null; greatest?: number | null }> = [];
  for (const [key, row] of Object.entries(entry.streams as Record<string, any>)) {
    if (!row) continue;
    if (key === 'pct24h') continue;
    rows.push({
      key,
      label: key.replace(/_/g, ' '),
      prev: toNumberOrNull(row?.prev),
      cur: toNumberOrNull(row?.cur),
      greatest: toNumberOrNull(row?.greatest),
    });
  }
  return rows;
}

function HistogramSections({ statsEntry, vectorRow }: { statsEntry: any; vectorRow: VectorRow | undefined }) {
  const binHistogram = resolveHistogram(statsEntry);
  const vectorHistogram = resolveVectorHistogram(vectorRow);
  if (!binHistogram && !vectorHistogram) return null;
  return (
    <div className="mt-4 space-y-4">
      {binHistogram ? (
        <div>
          <div className="text-[11px] uppercase tracking-wide text-indigo-200/80 mb-2">
            Binning histogram
          </div>
          <div className="rounded-2xl border border-indigo-900/30 bg-[#050517]/50 p-3">
            <Histogram counts={binHistogram.counts} nuclei={binHistogram.nuclei} height={88} accent="violet" />
          </div>
        </div>
      ) : null}
      {vectorHistogram ? (
        <div>
          <div className="text-[11px] uppercase tracking-wide text-indigo-200/80 mb-2">
            Vectors histogram
          </div>
          <div className="rounded-2xl border border-indigo-900/30 bg-[#050517]/50 p-3">
            <Histogram counts={vectorHistogram.counts} nuclei={vectorHistogram.nuclei} height={88} accent="cyan" />
          </div>
        </div>
      ) : null}
    </div>
  );
}

function resolveHistogram(entry: any) {
  const hist =
    entry?.hist ??
    entry?.stats?.histogram ??
    null;
  if (!hist || !Array.isArray(hist.counts)) return null;
  const counts = hist.counts.map((n: any) => Number(n) || 0);
  const nucleiSource =
    entry?.fm?.nuclei ??
    entry?.stats?.fm?.nuclei ??
    entry?.meta?.nuclei ??
    [];
  const nuclei = Array.isArray(nucleiSource)
    ? nucleiSource
        .map((n: any, idx: number) => {
          const bin = n?.binIndex ?? n?.key?.idhr ?? n?.key?.bin ?? n?.id ?? idx;
          return Number.isFinite(bin) ? Number(bin) : null;
        })
        .filter((idx: number | null): idx is number => typeof idx === "number" && idx >= 0 && idx < counts.length)
    : [];
  return { counts, nuclei };
}

function resolveVectorHistogram(row?: VectorRow) {
  const perBin = row?.payload?.inner?.perBin;
  if (!Array.isArray(perBin) || !perBin.length) return null;
  const counts = perBin.map((bin) => Number(bin.samples ?? 0) || 0);
  if (!counts.some((value) => value > 0)) return null;
  const sorted = [...perBin].sort(
    (a, b) => Number(b.share ?? 0) - Number(a.share ?? 0)
  );
  const highlight = sorted
    .slice(0, Math.min(3, sorted.length))
    .map((bin) => Number(bin.index ?? 0))
    .filter((idx) => Number.isFinite(idx) && idx >= 0 && idx < counts.length);
  return { counts, nuclei: highlight };
}

const toNumberOrNull = (value: unknown): number | null => {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};

function formatMaybe(value: any, fractionDigits = 4): string {
  if (value == null || Number.isNaN(value)) return '-';
  const num = Number(value);
  if (!Number.isFinite(num)) return String(value);
  return num.toFixed(fractionDigits);
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
