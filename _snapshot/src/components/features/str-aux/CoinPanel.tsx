'use client';

import React from 'react';

type StreamsRow = { prev?: number | null; cur?: number | null; greatest?: number | null };

type CoinOut = {
  ok: boolean;
  n?: number;
  bins?: number;
  window?: string;
  hist?: { counts: number[] };
  fm?: {
    gfm_price?: number | null;
    gfm_calc_price?: number | null;
    gfm_ref_price?: number | null;
    sigma?: number | null;
    zAbs?: number | null;
    vInner?: number | null;
    vOuter?: number | null;
    inertia?: number | null;
    disruption?: number | null;
    nuclei?: { binIndex: number }[];
  };
  cards?: {
    opening?: { benchmark?: number | null; pct24h?: number | null };
    live?: { benchmark?: number | null; pct24h?: number | null; pct_drv?: number | null };
  };
  sessionStats?: {
    priceMin?: number | null;
    priceMax?: number | null;
  };
  streams?: {
    benchmark?: StreamsRow;
    pct24h?: StreamsRow;
    pct_drv?: StreamsRow;
  };
  gfmDelta?: { absPct?: number | null };
  meta?: { uiEpoch?: number | null };
  lastUpdateTs?: number | null;
  error?: string;
};

const KNOWN_QUOTES = ['USDT', 'USDC', 'FDUSD', 'TUSD', 'BUSD', 'BTC', 'ETH', 'EUR', 'USD'];

export default function CoinPanel({
  symbol,
  coin,
  epochTs,
  windowSel,
}: {
  symbol: string;
  coin?: CoinOut;
  epochTs?: number;
  windowSel?: string;
}) {
  if (!coin) return <div className="cp-card">no data</div>;

  const { base, quote } = splitSymbol(symbol);
  const ok = coin.ok === true;

  const n = coin.n ?? 0;
  const bins = coin.bins ?? coin.hist?.counts?.length ?? 0;
  const updated = formatTime(coin.lastUpdateTs ?? epochTs);

  const opening = coin.cards?.opening?.benchmark ?? null;
  const price = coin.cards?.live?.benchmark ?? null;
  const pct24h = coin.cards?.live?.pct24h ?? coin.cards?.opening?.pct24h ?? null;
  const pctDrv = coin.cards?.live?.pct_drv ?? null;

  const gfm = firstFinite(coin.fm?.gfm_price, coin.fm?.gfm_calc_price);
  const gfmRef = coin.fm?.gfm_ref_price ?? null;
  const sigma = coin.fm?.sigma ?? null;
  const zAbs = coin.fm?.zAbs ?? null;
  const vInner = coin.fm?.vInner ?? null;
  const vOuter = coin.fm?.vOuter ?? null;
  const inertia = coin.fm?.inertia ?? null;
  const disruption = coin.fm?.disruption ?? null;
  const gfmDeltaPct = coin.gfmDelta?.absPct ?? null;
  const gfmDeltaLabel = Number.isFinite(gfmDeltaPct as number) ? fmtPct(gfmDeltaPct, 2) : null;

  const minPrice = coin.sessionStats?.priceMin ?? opening ?? null;
  const maxPrice = coin.sessionStats?.priceMax ?? price ?? null;

  const histCounts = coin.hist?.counts ?? [];
  const histNuclei = (coin.fm?.nuclei ?? []).map((n) => n.binIndex ?? 0);

  const epochLabel = coin.meta?.uiEpoch != null ? `#${coin.meta.uiEpoch}` : epochTs ? `#${epochTs}` : '-';

  return (
    <div className="cp-card">
      <div className="mb-2 flex items-start justify-between">
        <div className="flex items-center gap-2">
          <div className="rounded-full border px-2 py-1 text-xs">{base}</div>
          <div className="rounded-full border px-2 py-1 text-xs cp-subtle">/ {quote}</div>
        </div>
        <div className="text-[10px] cp-subtle">window {windowSel ?? coin.window ?? '-'}</div>
      </div>

      <div className="mb-2 grid grid-cols-4 gap-2 text-[11px]">
        <StatBox label="GFM" value={fmtNum(gfm)} sub={gfmRef ? `ref ${fmtNum(gfmRef)}` : undefined} />
        <StatBox label="sigma" value={fmtNum(sigma, 4)} />
        <StatBox label="|z|" value={fmtNum(zAbs, 3)} />
        <StatBox label="opening" value={fmtNum(opening)} />
      </div>

      <div className="mb-2">
        <MiniHist counts={histCounts} nuclei={histNuclei} />
      </div>

      <div className="mb-2 grid grid-cols-2 gap-2 text-[11px]">
        <div className="rounded-xl border p-2">
          <div className="cp-subtle">MIN / MAX</div>
          <div className="grid grid-cols-2 mt-1">
            <div className="cp-subtle">min</div>
            <div className="text-right tabular-nums">{fmtNum(minPrice)}</div>
            <div className="cp-subtle">max</div>
            <div className="text-right tabular-nums">{fmtNum(maxPrice)}</div>
          </div>
        </div>
        <div className="rounded-xl border p-2">
          <div className="cp-subtle">Live market - benchmark / pct24h / pct_drv</div>
          <div className="grid grid-cols-2 mt-1">
            <div className="cp-subtle">benchmark</div>
            <div className="text-right tabular-nums">{fmtNum(price)}</div>
            <div className="cp-subtle">pct24h</div>
            <div className="text-right tabular-nums">{fmtPct(pct24h)}</div>
            <div className="cp-subtle">pct_drv</div>
            <div className="text-right tabular-nums">{fmtPct(pctDrv, 3)}</div>
          </div>
        </div>
      </div>

      <div className="mb-2 rounded-xl border p-2">
        <div className="mb-1 cp-subtle text-[11px]">Streams</div>
        <table className="w-full text-[11px]">
          <thead className="cp-subtle">
            <tr>
              <th className="text-left font-normal">metric</th>
              <th className="text-right font-normal">prev</th>
              <th className="text-right font-normal">cur</th>
              <th className="text-right font-normal">greatest</th>
            </tr>
          </thead>
          <tbody>
            <StreamRow name="benchmark" data={coin.streams?.benchmark} />
            <StreamRow name="pct24h" data={coin.streams?.pct24h} />
            <StreamRow name="pct_drv" data={coin.streams?.pct_drv} decimals={3} />
          </tbody>
        </table>
      </div>

      <div className="grid grid-cols-2 gap-2 text-[11px]">
        <div className="rounded-xl border p-2">
          <div className="grid grid-cols-2 gap-y-1">
            <div className="cp-subtle">n</div>
            <div className="text-right tabular-nums">{n}</div>
            <div className="cp-subtle">bins</div>
            <div className="text-right tabular-nums">{bins}</div>
            <div className="cp-subtle">epoch</div>
            <div className="text-right tabular-nums">{epochLabel}</div>
            <div className="cp-subtle">updated</div>
            <div className="text-right tabular-nums">{updated}</div>
          </div>
        </div>
        <div className="rounded-xl border p-2">
          <div className="grid grid-cols-2 gap-y-1">
            <div className="cp-subtle">vInner</div>
            <div className="text-right tabular-nums">{fmtNum(vInner, 2)}</div>
            <div className="cp-subtle">vOuter</div>
            <div className="text-right tabular-nums">{fmtNum(vOuter, 2)}</div>
            <div className="cp-subtle">inertia</div>
            <div className="text-right tabular-nums">{fmtNum(inertia, 3)}</div>
            <div className="cp-subtle">disruption</div>
            <div className="text-right tabular-nums">
              {fmtNum(disruption, 3)}
              {gfmDeltaLabel ? <span className="ml-1 text-[10px] cp-subtle">delta {gfmDeltaLabel}</span> : null}
            </div>
          </div>
        </div>
      </div>

      {!ok && <div className="mt-2 text-amber-300 text-[11px]">unavailable{coin.error ? ` - ${coin.error}` : ''}</div>}
    </div>
  );
}

function splitSymbol(sym: string): { base: string; quote: string } {
  const upper = String(sym || '').toUpperCase();
  for (const q of KNOWN_QUOTES) {
    if (upper.endsWith(q) && upper.length > q.length) {
      return { base: upper.slice(0, -q.length), quote: q };
    }
  }
  if (upper.length > 4) {
    return { base: upper.slice(0, upper.length - 4), quote: upper.slice(-4) };
  }
  return { base: upper, quote: 'USDT' };
}

function fmtNum(value: number | null | undefined, digits = 6) {
  return Number.isFinite(value as number)
    ? (value as number).toLocaleString(undefined, { maximumFractionDigits: digits })
    : '-';
}

function fmtPct(value: number | null | undefined, digits = 2) {
  if (!Number.isFinite(value as number)) return '-';
  const n = value as number;
  return `${n >= 0 ? '+' : ''}${n.toFixed(digits)}%`;
}

function formatTime(ts?: number | null) {
  if (!Number.isFinite(ts as number)) return '-';
  try {
    return new Date(ts as number).toLocaleTimeString();
  } catch {
    return '-';
  }
}

function firstFinite(...values: Array<number | null | undefined>) {
  for (const v of values) {
    if (Number.isFinite(v as number)) return v as number;
  }
  return null;
}

function StatBox({ label, value, sub }: { label: string; value: React.ReactNode; sub?: string }) {
  return (
    <div className="rounded-xl border p-2">
      <div className="cp-subtle text-[10px] uppercase tracking-wide">{label}</div>
      <div className="text-sm tabular-nums">{value}</div>
      {sub ? <div className="cp-subtle text-[10px] mt-1">{sub}</div> : null}
    </div>
  );
}

function StreamRow({ name, data, decimals = 2 }: { name: string; data?: StreamsRow; decimals?: number }) {
  const fmt = (value?: number | null) => fmtPct(value ?? null, decimals);
  return (
    <tr>
      <td className="py-0.5">{name}</td>
      <td className="py-0.5 text-right tabular-nums">{fmt(data?.prev ?? null)}</td>
      <td className="py-0.5 text-right tabular-nums">{fmt(data?.cur ?? null)}</td>
      <td className="py-0.5 text-right tabular-nums">{fmt(data?.greatest ?? null)}</td>
    </tr>
  );
}

function MiniHist({ counts, nuclei }: { counts: number[]; nuclei: number[] }) {
  if (!counts?.length) return <div className="h-[64px] cp-subtle text-[11px]">no hist</div>;
  const max = Math.max(...counts, 1);
  return (
    <div className="h-[72px]">
      <svg width="100%" viewBox="0 0 360 64" className="block">
        {counts.map((c, i) => {
          const h = (c / max) * 62;
          const w = 360 / counts.length;
          const x = i * w;
          const y = 64 - h;
          const isNucleus = nuclei?.includes(i);
          return (
            <g key={i}>
              <rect x={x + 0.5} y={y} width={Math.max(1, w - 1)} height={h} fill="currentColor" opacity={0.25} />
              {isNucleus && (
                <rect
                  x={x + 0.5}
                  y={y}
                  width={Math.max(1, w - 1)}
                  height={h}
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={1}
                  opacity={0.9}
                />
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
}
