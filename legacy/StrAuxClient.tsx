// src/app/str-aux/StrAuxClient.tsx
'use client';

import React from 'react';
import Histogram from '@/components/features/str-aux/Histogram';

/* ---------- Types that match /api/str-aux/stats ---------- */
type WindowKey = '30m' | '1h' | '3h';

type SymStamp = { ts: number; price: number; gfm?: number; deltaPct?: number };
type Tendency = { direction: number; strength: number; slope: number; r: number; score: number };
type StatRow = {
  sigma: number; zAbs: number;

  // FloMo (abs) + BFloM (0..1)
  gfmAbs: number; refGfmAbs: number; deltaGfmAbs: number; deltaGfmPct: number; shiftedGfm: boolean;
  bfm01: number; refBfm01: number; deltaBfm01: number; deltaBfmPct: number; shiftedBfm: boolean;

  // vectors
  vInner: number; vOuter: number; tendency: Tendency;
  vSwap?: { Q: number; score: number; q1: number; q3: number } | null;

  // toolbox (optional)
  inertia?: { static: number; growth: number; total: number; face: 'static'|'growth' };
  amp?: number; volt?: number; efficiency?: number;

  // raw helpers
  opening: number; last: number; prev: number;
};
type ApiOut = {
  ok: boolean;
  symbols: string[];
  window: WindowKey;
  ts: number;
  out: {
    [symbol: string]: {
      ok: boolean; error?: string; window: WindowKey; n: number;
      cards?: {
        opening: { benchmark: number; pct24h?: number };
        live:    { benchmark: number; pct_drv?: number; pct24h?: number };
      };
      stats?: StatRow;
      extrema?: { priceMin?: number; priceMax?: number; benchPctMin?: number; benchPctMax?: number };
      streams?: { stamps?: SymStamp[]; maxStamps?: number };
      shifts?: { nShifts: number; latestTs: number };
      hist?: {
        counts: number[];
        edges?: number[];
        probs?: number[];
        densest?: Array<number | { idx?: number; index?: number; binIndex?: number }>;
        returnsPct?: number[];
        muR?: number;
        sigmaR?: number;
        total?: number;
        binWidth?: number | null;
        rMin?: number | null;
        rMax?: number | null;
      };
      meta?: { uiEpoch: number; epsPct: number; kCycles: number };
      lastUpdateTs?: number;
      db_error?: string;
    };
  };
};

/* ---------- helpers ---------- */
const U = (s: unknown) => String(s ?? '').trim().toUpperCase();
const KNOWN_QUOTES = ['USDT','BTC','ETH','BNB','BUSD','FDUSD','USDC','TUSD'] as const;
function splitSymbol(sym: string): { base: string; quote: string } {
  const S = U(sym);
  for (const q of KNOWN_QUOTES) if (S.endsWith(q) && S.length > q.length) return { base: S.slice(0, -q.length), quote: q };
  return { base: S.replace(/USDT$/i, ''), quote: 'USDT' };
}
const uniq = <T,>(xs: T[]) => Array.from(new Set(xs));
const fmtNum = (n?: number) => (Number.isFinite(n as number) ? (n as number).toLocaleString(undefined, { maximumFractionDigits: 6 }) : 'ÔÇö');
const fmtPct = (n?: number) => (Number.isFinite(n as number) ? `${(n as number)>=0?'+':''}${(n as number).toFixed(2)}%` : 'ÔÇö');
const fmtPlainPct = (n?: number) => (Number.isFinite(n as number) ? `${(n as number).toFixed(2)}%` : 'ÔÇö');
const fmtTime = (ts?: number) => (typeof ts === 'number' && Number.isFinite(ts) ? new Date(ts).toLocaleTimeString() : 'ÔÇö');
const fmtDateTime = (ts?: number) => (typeof ts === 'number' && Number.isFinite(ts) ? new Date(ts).toLocaleString() : 'ÔÇö');

type Tone = 'good' | 'muted' | 'bad';
const toneForNumber = (n?: number | null): Tone | undefined => {
  if (typeof n !== 'number' || !Number.isFinite(n)) return undefined;
  if (n > 0) return 'good';
  if (n < 0) return 'bad';
  return undefined;
};

function cardStyle(bg: string, border: string): React.CSSProperties {
  return {
    padding: 12,
    borderRadius: 10,
    background: bg,
    border: `1px solid ${border}`,
  };
}

function toCountArray(values?: readonly unknown[]): number[] {
  if (!Array.isArray(values)) return [];
  return values.map((value) => {
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
  });
}

function toAlignedNumberArray(values?: readonly unknown[]): number[] {
  if (!Array.isArray(values)) return [];
  return values.map((value) => {
    const n = Number(value);
    return Number.isFinite(n) ? n : NaN;
  });
}

function logReturnToPct(value?: number | null): number | null {
  if (!Number.isFinite(value as number)) return null;
  return Math.expm1(value as number) * 100;
}

function extractDensestIndices(
  source: unknown,
  bins: number,
): number[] {
  if (!Array.isArray(source) || !Number.isFinite(bins) || bins <= 0) return [];
  const out: number[] = [];
  for (const entry of source) {
    let idx: number | null = null;
    if (typeof entry === 'number' && Number.isFinite(entry)) {
      idx = Math.round(entry);
    } else if (entry && typeof entry === 'object') {
      const maybeIdx = (entry as any).idx ?? (entry as any).index ?? (entry as any).binIndex;
      const n = Number(maybeIdx);
      if (Number.isFinite(n)) idx = Math.round(n);
    }
    if (idx != null && idx >= 0 && idx < bins) out.push(idx);
  }
  return Array.from(new Set(out));
}

/* ---------- Controls (was missing) ---------- */
function Controls(props: {
  windowKey: WindowKey; setWindowKey: (v: WindowKey) => void;
  bins: number; setBins: (n: number) => void;
  sessionId: string; setSessionId: (v: string) => void;
  epsPct: number; setEpsPct: (n: number) => void;
  kCycles: number; setKCycles: (n: number) => void;
}) {
  const { windowKey, setWindowKey, bins, setBins, sessionId, setSessionId, epsPct, setEpsPct, kCycles, setKCycles } = props;

  return (
    <div style={{
      display: 'grid', gap: 10, padding: 12, borderRadius: 8,
      border: '1px solid rgba(255,255,255,0.08)', background: 'rgba(255,255,255,0.02)'
    }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 10 }}>
        <label style={{ display: 'grid', gap: 6 }}>
          <span style={{ fontSize: 12, opacity: 0.8 }}>window</span>
          <select
            value={windowKey}
            onChange={(e) => setWindowKey(e.target.value as WindowKey)}
            style={{ padding: '6px 8px', background: '#0e1320', border: '1px solid #2a3350', borderRadius: 6, color: '#e5e7eb' }}
          >
            <option value="30m">30m</option>
            <option value="1h">1h</option>
            <option value="3h">3h</option>
          </select>
        </label>
        <label style={{ display: 'grid', gap: 6 }}>
          <span style={{ fontSize: 12, opacity: 0.8 }}>bins</span>
          <input
            type="number" min={16} max={1024} step={1} value={bins}
            onChange={(e) => setBins(Math.max(16, Math.min(1024, Math.floor(Number(e.target.value) || 128))))}
            style={{ padding: '6px 8px', background: '#0e1320', border: '1px solid #2a3350', borderRadius: 6, color: '#e5e7eb' }}
          />
        </label>
        <label style={{ display: 'grid', gap: 6 }}>
          <span style={{ fontSize: 12, opacity: 0.8 }}>session id</span>
          <input
            type="text" value={sessionId} onChange={(e) => setSessionId(e.target.value.slice(0, 64))}
            placeholder="dev-01"
            style={{ padding: '6px 8px', background: '#0e1320', border: '1px solid #2a3350', borderRadius: 6, color: '#e5e7eb' }}
          />
        </label>
        <label style={{ display: 'grid', gap: 6 }}>
          <span style={{ fontSize: 12, opacity: 0.8 }}>╬Á (╬öGFM %)</span>
          <input
            type="number" step="0.01" min="0.01" max="5" value={epsPct}
            onChange={(e) => setEpsPct(Math.max(0.01, Math.min(5, Number(e.target.value) || 0.35)))}
            style={{ padding: '6px 8px', background: '#0e1320', border: '1px solid #2a3350', borderRadius: 6, color: '#e5e7eb' }}
          />
        </label>
        <label style={{ display: 'grid', gap: 6 }}>
          <span style={{ fontSize: 12, opacity: 0.8 }}>k cycles</span>
          <input
            type="number" min={1} max={12} value={kCycles}
            onChange={(e) => setKCycles(Math.max(1, Math.min(12, Math.floor(Number(e.target.value) || 5))))}
            style={{ padding: '6px 8px', background: '#0e1320', border: '1px solid #2a3350', borderRadius: 6, color: '#e5e7eb' }}
          />
        </label>
      </div>
    </div>
  );
}

/* ---------- light toggles ---------- */
function Pill({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: '6px 10px', borderRadius: 999,
        border: `1px solid ${active ? '#93c5fd' : 'rgba(255,255,255,0.12)'}`,
        background: active ? 'rgba(147,197,253,0.08)' : 'transparent',
        color: active ? '#dbeafe' : '#e5e7eb',
        cursor: 'pointer'
      }}
    >{children}</button>
  );
}
function CoinToggles(props: {
  universe: string[]; suggested: string[]; selected: string[]; setSelected: (v: string[]) => void; loading?: boolean; title: string;
}) {
  const { universe, suggested, selected, setSelected, loading, title } = props;
  const bases = (suggested.length ? suggested : universe).sort();
  return (
    <div style={{ display: 'grid', gap: 8 }}>
      <div style={{ fontSize: 12, opacity: 0.8 }}>{title}</div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        {loading ? <span style={{ opacity: 0.7 }}>loadingÔÇª</span> :
          bases.map(b => (
            <Pill key={b} active={selected.includes(b)} onClick={() => {
              setSelected(selected.includes(b) ? selected.filter(x => x !== b) : [...selected, b]);
            }}>{b}</Pill>
          ))
        }
      </div>
    </div>
  );
}
function SymbolToggles(props: {
  pool: string[]; selected: string[]; setSelected: (v: string[]) => void; title: string;
}) {
  const { pool, selected, setSelected, title } = props;
  const syms = pool.sort();
  return (
    <div style={{ display: 'grid', gap: 8 }}>
      <div style={{ fontSize: 12, opacity: 0.8 }}>{title}</div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        {syms.map(s => (
          <Pill key={s} active={selected.includes(s)} onClick={() => {
            setSelected(selected.includes(s) ? selected.filter(x => x !== s) : [...selected, s]);
          }}>{s}</Pill>
        ))}
      </div>
    </div>
  );
}

/* ---------- small UI atoms ---------- */
function KV({ label, value, accent, tone }: { label: string; value: React.ReactNode; accent?: boolean; tone?: Tone }) {
  const color = tone === 'good'
    ? '#67e8f9'
    : tone === 'bad'
      ? '#fca5a5'
      : tone === 'muted'
        ? 'rgba(229,231,235,0.6)'
        : '#e5e7eb';
  return (
    <div style={{ display: 'grid', gap: 2 }}>
      <div style={{ fontSize: 11, opacity: 0.7 }}>{label}</div>
      <div style={{ fontSize: accent ? 14 : 13, fontWeight: accent ? 600 : 500, color }}>{value}</div>
    </div>
  );
}

function MetricTile({ label, value, sub, tone }: { label: string; value: React.ReactNode; sub?: React.ReactNode; tone?: Tone }) {
  const border = tone === 'good'
    ? 'rgba(103,232,249,0.45)'
    : tone === 'bad'
      ? 'rgba(248,113,113,0.4)'
      : 'rgba(148,163,184,0.18)';
  const color = tone === 'good'
    ? '#67e8f9'
    : tone === 'bad'
      ? '#fca5a5'
      : '#f8fafc';
  return (
    <div style={{
      display: 'grid', gap: 4,
      padding: '10px 12px',
      borderRadius: 10,
      border: `1px solid ${border}`,
      background: 'rgba(15,23,42,0.72)',
      boxShadow: '0 6px 14px rgba(8,15,35,0.35)'
    }}>
      <div style={{ fontSize: 11, opacity: 0.7 }}>{label}</div>
      <div style={{ fontSize: 16, fontWeight: 600, color }}>{value}</div>
      {sub ? <div style={{ fontSize: 11, opacity: 0.75 }}>{sub}</div> : null}
    </div>
  );
}

function SectionBox({ title, subtitle, children }: { title: string; subtitle?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div style={{
      display: 'grid', gap: 10,
      padding: '12px 14px',
      borderRadius: 10,
      border: '1px solid rgba(148,163,184,0.18)',
      background: 'rgba(11,17,30,0.78)'
    }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 }}>
        <div style={{ fontSize: 11, opacity: 0.65, letterSpacing: 0.5, textTransform: 'uppercase' }}>{title}</div>
        {subtitle ? <div style={{ fontSize: 11, opacity: 0.55 }}>{subtitle}</div> : null}
      </div>
      {children}
    </div>
  );
}

type MetricItem = { label: string; value: React.ReactNode; tone?: Tone; accent?: boolean };
function MetricGrid({ items, columns = 2 }: { items: MetricItem[]; columns?: number }) {
  if (!items.length) return null;
  return (
    <div style={{ display: 'grid', gap: 8, gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}>
      {items.map((item, idx) => (
        <KV
          key={`${item.label}-${idx}`}
          label={item.label}
          value={item.value ?? '—'}
          tone={item.tone}
          accent={item.accent}
        />
      ))}
    </div>
  );
}
function StreamsTable({ stamps }: { stamps?: SymStamp[] }) {
  if (!stamps?.length) return null;
  const rows = stamps.slice(-12);
  return (
    <div style={{ display: 'grid', gap: 6, fontSize: 12 }}>
      <div style={{ display: 'grid', gridTemplateColumns: '120px 1fr 1fr 1fr', gap: 6, opacity: 0.6 }}>
        <div>ts</div>
        <div>price</div>
        <div>gfm</div>
        <div>Δ%</div>
      </div>
      {rows.map((s, i) => (
        <div key={i} style={{ display: 'grid', gridTemplateColumns: '120px 1fr 1fr 1fr', gap: 6 }}>
          <div>{fmtTime(s.ts)}</div>
          <div>{fmtNum(s.price)}</div>
          <div>{fmtNum(s.gfm)}</div>
          <div>{fmtPct(s.deltaPct)}</div>
        </div>
      ))}
    </div>
  );
}

/* ---------- data hooks ---------- */

  const toolboxItems: MetricItem[] = [
    { label: 'inertia static', value: fmtNum(stats?.inertia?.static) },
    { label: 'inertia growth', value: fmtNum(stats?.inertia?.growth) },
    { label: 'inertia total', value: fmtNum(stats?.inertia?.total) },
    { label: 'face', value: stats?.inertia?.face ?? '-', tone: stats?.inertia?.face === 'growth' ? 'good' : stats?.inertia?.face === 'static' ? 'muted' : undefined },
    { label: 'amp', value: fmtNum(stats?.amp) },
    { label: 'volt', value: fmtNum(stats?.volt) },
    { label: 'efficiency', value: fmtPct(stats?.efficiency) },
  ];

  const metaItems: MetricItem[] = [
    { label: 'window', value: row.window },
    { label: 'observations', value: Number.isFinite(row.n) ? String(row.n) : '-' },
    { label: 'bins', value: Number.isFinite(bins) ? String(bins) : '-' },
    { label: 'epoch', value: meta?.uiEpoch != null ? `#${meta.uiEpoch}` : '-' },
    { label: 'eps', value: fmtPlainPct(meta?.epsPct) },
    { label: 'k cycles', value: meta?.kCycles != null ? String(meta.kCycles) : '-' },
    { label: 'shifts', value: shifts?.nShifts != null ? String(shifts.nShifts) : '-' },
    { label: 'latest shift', value: fmtTime(shifts?.latestTs) },
    { label: 'updated', value: fmtTime(latestTs) },
  ];

  const headerMetaParts = [
    meta?.uiEpoch != null ? `epoch #${meta.uiEpoch}` : null,
    meta?.epsPct != null ? `eps ${fmtPlainPct(meta.epsPct)}` : null,
    meta?.kCycles != null ? `k ${meta.kCycles}` : null,
  ].filter(Boolean) as string[];
  const headerMeta = headerMetaParts.join(' | ');

  const cardBorder = shiftedGfm || shiftedBfm ? 'rgba(103,232,249,0.45)' : 'rgba(99,102,241,0.4)';

  return (
    <div
      style={{
        display: 'grid',
        gap: 14,
        padding: '16px 18px',
        borderRadius: 14,
        background: 'linear-gradient(165deg, rgba(17,24,39,0.96), rgba(7,12,24,0.92))',
        border: `1px solid ${cardBorder}`,
        boxShadow: '0 18px 35px rgba(8,15,35,0.55)',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
        <div style={{ display: 'grid', gap: 4 }}>
          <strong style={{ fontSize: 18, letterSpacing: 0.3 }}>{sym}</strong>
          <div style={{ fontSize: 12, opacity: 0.65 }}>{base}/{quote}</div>
        </div>
        <div style={{ display: 'grid', gap: 4, textAlign: 'right', fontSize: 11, opacity: 0.75 }}>
          <div>{`window ${row.window} | n=${Number.isFinite(row.n) ? row.n : '-'} | bins=${Number.isFinite(bins) ? bins : '-'}`}</div>
          {headerMeta ? <div>{headerMeta}</div> : null}
          <div>{`updated ${fmtTime(latestTs)}`}</div>
        </div>
      </div>

      <div style={{ display: 'grid', gap: 10, gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))' }}>
        {topTiles.map((tile, idx) => (
          <MetricTile
            key={`${sym}-top-${idx}`}
            label={tile.label.toUpperCase()}
            value={tile.value}
            sub={tile.sub}
            tone={tile.tone}
          />
        ))}
      </div>

      <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))' }}>
        <SectionBox title="FloMo" subtitle={shiftedGfm ? 'shifted' : undefined}>
          <MetricGrid items={floMoItems} columns={2} />
        </SectionBox>
        <SectionBox title="BFloM" subtitle={shiftedBfm ? 'shifted' : undefined}>
          <MetricGrid items={bFloMItems} columns={2} />
        </SectionBox>
        <SectionBox title="Price & Extrema">
          <MetricGrid items={priceItems} columns={2} />
        </SectionBox>
        <SectionBox title="Vectors">
          <MetricGrid items={vectorItems} columns={2} />
        </SectionBox>
        <SectionBox title="Toolbox">
          <MetricGrid items={toolboxItems} columns={2} />
        </SectionBox>
        <SectionBox title="Shifts & Meta">
          <MetricGrid items={metaItems} columns={2} />
        </SectionBox>
      </div>

      {(histCounts.length || streams.length) && (
        <div
          style={{
            display: 'grid',
            gap: 12,
            gridTemplateColumns: histCounts.length && streams.length ? 'repeat(auto-fit, minmax(280px, 1fr))' : 'minmax(0, 1fr)',
          }}
        >
          {histCounts.length ? (
            <SectionBox title="Histogram" subtitle={histSubtitle || undefined}>
              <div style={{ display: 'grid', gap: 10 }}>
                <Histogram counts={histCounts} nuclei={histNuclei} height={88} accent={histogramAccent} />
                <MetricGrid items={histStatItems} columns={3} />
              </div>
            </SectionBox>
          ) : null}
          {streams.length ? (
            <SectionBox
              title="Streams"
              subtitle={`last ${Math.min(12, streams.length)} / ${row.streams?.maxStamps ?? streams.length}`}
            >
              <StreamsTable stamps={streams} />
            </SectionBox>
          ) : null}
        </div>
      )}

      {row.db_error ? (
        <SectionBox title="db error">
          <div style={{ fontSize: 12, color: '#fca5a5' }}>{row.db_error}</div>
        </SectionBox>
      ) : null}
    </div>
  );
}


/* ---------- data hooks ---------- */
function usePreviewUniverse() {
  const [universeSymbols, setUniverseSymbols] = React.useState<string[]>([]);
  const [settingsSymbols, setSettingsSymbols] = React.useState<string[]>([]);
  const [basesUniverse, setBasesUniverse] = React.useState<string[]>([]);
  const [basesSettings, setBasesSettings] = React.useState<string[]>([]);
  const [loading, setLoading] = React.useState(true);

  React.useEffect(() => {
    let alive = true;
    (async () => {
      try {
        setLoading(true);
        const response = await fetch("/api/preview/universe/symbols", { cache: "no-store" });
        if (!response.ok) throw new Error("preview/universe/symbols unavailable");
        const payload = await response.json().catch(() => ({}));

        const rawSymbols = Array.isArray(payload?.symbols) ? payload.symbols : [];
        const rawCoins = Array.isArray(payload?.coins) ? payload.coins : [];
        const quote = U(payload?.quote ?? "USDT");

        const normalizedSymbols = uniq(
          (rawSymbols ?? [])
            .map((value: unknown) => (typeof value === "string" ? value : String(value ?? "")))
            .map(U)
            .filter(Boolean)
        );

        const normalizedPairs = normalizedSymbols
          .map((symbol) => {
            const sym = U(symbol);
            if (!sym) return null;
            if (quote && sym.endsWith(quote) && sym.length > quote.length) {
              const base = sym.slice(0, sym.length - quote.length);
              if (!base || base === quote) return null;
              return { symbol: sym, base, quote };
            }
            const { base, quote: derivedQuote } = splitSymbol(sym);
            if (!base || !derivedQuote || base === derivedQuote) return null;
            return { symbol: sym, base, quote: derivedQuote };
          })
          .filter((entry): entry is { symbol: string; base: string; quote: string } => Boolean(entry));

        const pairBases = uniq(
          normalizedPairs.map((entry) => entry.base).filter((base) => base && base !== quote)
        );

        const coinBases = uniq(
          (rawCoins ?? [])
            .map((value: unknown) => (typeof value === "string" ? value : String(value ?? "")))
            .map(U)
            .filter((coin) => coin && coin !== quote)
        );

        if (!alive) return;
        setUniverseSymbols(normalizedSymbols);
        setSettingsSymbols(normalizedSymbols);
        setBasesUniverse(pairBases.length ? pairBases : coinBases);
        setBasesSettings(coinBases.length ? coinBases : pairBases);
      } catch {
        if (!alive) return;
        setUniverseSymbols([]);
        setSettingsSymbols([]);
        setBasesUniverse([]);
        setBasesSettings([]);
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  return { universeSymbols, settingsSymbols, basesUniverse, basesSettings, loading };
}

function useStats(params: {
  windowKey: WindowKey; bins: number; sessionId: string;
  bases?: string[]; symbols?: string[]; epsPct?: number; kCycles?: number; refreshMs?: number;
}) {
  const [data, setData] = React.useState<ApiOut | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [err, setErr] = React.useState<string | null>(null);

  const query = React.useMemo(() => {
    const p = new URLSearchParams();
    p.set('window', params.windowKey);
    p.set('bins', String(params.bins));
    p.set('sessionId', params.sessionId);
    if (params.symbols?.length) p.set('symbols', params.symbols.join(','));
    else if (params.bases?.length) p.set('bases', params.bases.join(','));
    if (params.epsPct != null) p.set('eps', String(params.epsPct));
    if (params.kCycles != null) p.set('k', String(params.kCycles));
    return p.toString();
  }, [params.windowKey, params.bins, params.sessionId, params.bases, params.symbols, params.epsPct, params.kCycles]);

  React.useEffect(() => {
    let alive = true;
    async function run() {
      try {
        setLoading(true); setErr(null);
        const r = await fetch(`/api/str-aux/stats?${query}`, { cache: 'no-store' });
        const j = (await r.json()) as ApiOut;
        if (!alive) return;
        if (!r.ok || !j?.ok) { setErr((j as any)?.error ?? `HTTP ${r.status}`); setData(null); }
        else { setData(j); }
      } catch (e: any) { if (alive) { setErr(e?.message ?? String(e)); setData(null); } }
      finally { if (alive) setLoading(false); }
    }
    run();
    const t = setInterval(run, Math.max(2000, params.refreshMs ?? 7000));
    return () => { alive = false; clearInterval(t); };
  }, [query, params.refreshMs]);

  return { data, loading, err };
}

/* ---------- main component ---------- */
export default function StrAuxClient() {
  const [windowKey, setWindowKey] = React.useState<WindowKey>('30m');
  const [bins, setBins] = React.useState(128);
  const [sessionId, setSessionId] = React.useState('dev-01');
  const [epsPct, setEpsPct] = React.useState(0.35);
  const [kCycles, setKCycles] = React.useState(5);

  const { universeSymbols, basesUniverse, basesSettings, loading: loadingPrev } = usePreviewUniverse();

  const [selectedBases, setSelectedBases] = React.useState<string[]>([]);
  React.useEffect(() => {
    const saved = localStorage.getItem('STR_AUX_SELECTED_BASES');
    const cached = saved ? (JSON.parse(saved) as string[]) : null;
    if (basesSettings.length) setSelectedBases(cached?.length ? [...new Set(cached.map(U).filter(b => basesSettings.includes(b)))] : basesSettings);
    else if (cached?.length) setSelectedBases([...new Set(cached.map(U))]);
    else setSelectedBases([]);
  }, [basesSettings]);
  React.useEffect(() => { localStorage.setItem('STR_AUX_SELECTED_BASES', JSON.stringify(selectedBases)); }, [selectedBases]);

  const [selectedSymbols, setSelectedSymbols] = React.useState<string[]>([]);
  React.useEffect(() => {
    const saved = localStorage.getItem('STR_AUX_SELECTED_SYMBOLS');
    const cached = saved ? (JSON.parse(saved) as string[]) : null;
    const pool = universeSymbols
      .filter(s => basesSettings.includes(splitSymbol(s).base))
      .filter(s => selectedBases.includes(splitSymbol(s).base));
    const initial = cached?.length ? [...new Set(cached.map(U).filter(s => pool.includes(s)))] : [...new Set(pool)];
    setSelectedSymbols(initial);
  }, [universeSymbols, basesSettings, selectedBases]);
  React.useEffect(() => { localStorage.setItem('STR_AUX_SELECTED_SYMBOLS', JSON.stringify(selectedSymbols)); }, [selectedSymbols]);

  const { data, loading, err } = useStats({
    windowKey, bins, sessionId,
    symbols: selectedSymbols.length ? selectedSymbols : undefined,
    bases: !selectedSymbols.length && selectedBases.length ? selectedBases : undefined,
    epsPct, kCycles, refreshMs: 7000,
  });

  const symbols = data?.symbols ?? [];
  const out = data?.out ?? {};

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <Controls
        windowKey={windowKey} setWindowKey={setWindowKey}
        bins={bins} setBins={setBins}
        sessionId={sessionId} setSessionId={(v) => { const x = v.slice(0,64); setSessionId(x); localStorage.setItem('APP_SESSION_ID', x); }}
        epsPct={epsPct} setEpsPct={setEpsPct}
        kCycles={kCycles} setKCycles={setKCycles}
      />

      <CoinToggles
        universe={basesUniverse}
        suggested={basesSettings.length ? basesSettings : basesUniverse}
        selected={selectedBases}
        setSelected={setSelectedBases}
        loading={loadingPrev}
        title="coins"
      />

      <SymbolToggles
        pool={universeSymbols
          .filter(s => basesSettings.includes(splitSymbol(s).base))
          .filter(s => selectedBases.includes(splitSymbol(s).base))}
        selected={selectedSymbols}
        setSelected={setSelectedSymbols}
        title="symbols"
      />

      {err && <div style={cardStyle('#3b1d1d', '#fca5a5')}><b>error</b>: {err}</div>}
      {(loading || loadingPrev) && <div style={{ opacity: 0.8, fontSize: 13 }}>loadingÔÇª</div>}
      {!loading && !loadingPrev && symbols.length === 0 && <div style={{ opacity: 0.8, fontSize: 13 }}>no symbols ÔÇö adjust toggles</div>}

      <div style={{
        display: 'grid',
        gap: 16,
        gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
        alignItems: 'stretch',
        maxWidth: '1600px',
        width: '100%',
        margin: '0 auto'
      }}>
        {symbols.map((sym) => <SymbolPanel key={sym} sym={sym} row={out[sym]} bins={bins} />)}
      </div>
    </div>
  );
}

/* ---------- symbol card ---------- */
function SymbolPanel({ sym, row, bins }: { sym: string; row: ApiOut['out'][string] | undefined; bins: number }) {
  if (!row) {
    return (
      <div style={cardStyle('#281a1a', '#eab308')}>
        <strong>{sym}</strong>
        <div style={{ opacity: 0.75, fontSize: 12 }}>no data</div>
      </div>
    );
  }

  if (!row.ok) {
    return (
      <div style={cardStyle('#281a1a', '#eab308')}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <strong>{sym}</strong>
          <span style={{ opacity: 0.7, fontSize: 12 }}>{row.error ?? 'unavailable'}</span>
        </div>
      </div>
    );
  }
  const extraItems = [
   { label: 'vOuter', value: fmtNum(stats?.vOuter) },
    { label: 'tendency score', value: fmtNum(stats?.tendency?.score), tone: toneForNumber(stats?.tendency?.score) },
    { label: 'direction', value: fmtNum(stats?.tendency?.direction) },
    { label: 'strength', value: fmtNum(stats?.tendency?.strength) },
    { label: 'slope', value: fmtNum(stats?.tendency?.slope) },
    { label: 'correlation', value: fmtNum(stats?.tendency?.r) },
    { label: 'vSwap score', value: fmtNum(vSwap?.score), tone: toneForNumber(vSwap?.score) },
    { label: 'vSwap Q', value: fmtNum(vSwap?.Q) },
    { label: 'vSwap q1', value: fmtNum(vSwap?.q1) },
    { label: 'vSwap q3', value: fmtNum(vSwap?.q3) },
  ];
  const stats = row.stats ?? null;
  const open = row.cards?.opening;
  const live = row.cards?.live;
  const extrema = row.extrema ?? {};
  const t24 = live?.pct24h ?? open?.pct24h;

  const { base, quote } = splitSymbol(sym);
  const meta = row.meta;
  const shifts = row.shifts;
  const shiftedGfm = Boolean(stats?.shiftedGfm);
  const shiftedBfm = Boolean(stats?.shiftedBfm);
  const latestTs = row.lastUpdateTs ?? shifts?.latestTs ?? null;
  const vSwap = stats?.vSwap ?? null;

  const histCounts = toCountArray(row.hist?.counts);
  const histReturns = toAlignedNumberArray(row.hist?.returnsPct);
  const histNuclei = extractDensestIndices(row.hist?.densest, histCounts.length);
  const histMuPct = logReturnToPct(row.hist?.muR);
  const histSigmaPct = logReturnToPct(row.hist?.sigmaR);
  const histBinPct = logReturnToPct(row.hist?.binWidth);

  const histSubtitleParts: string[] = [];
  if (histCounts.length) histSubtitleParts.push(`${histCounts.length} bins`);
  if (histBinPct != null) histSubtitleParts.push(`bin ~ ${fmtPlainPct(Math.abs(histBinPct))}`);
  const histSubtitle = histSubtitleParts.join(' | ');

  const histMidReturn = histReturns.length ? histReturns[Math.floor(histReturns.length / 2)] : undefined;
  const histStatItems: MetricItem[] = [
    { label: 'return min', value: fmtPct(histReturns[0]) },
    { label: 'return mid', value: fmtPct(histMidReturn) },
    { label: 'return max', value: fmtPct(histReturns[histReturns.length - 1]) },
    { label: 'mu', value: fmtPct(histMuPct ?? undefined) },
    { label: 'sigma', value: fmtPlainPct(histSigmaPct != null ? Math.abs(histSigmaPct) : undefined) },
    { label: 'samples', value: fmtNum(row.hist?.total ?? row.n) },
  ];

  const streams = row.streams?.stamps ?? [];
  const histogramAccent: 'emerald' | 'cyan' | 'violet' | 'silver' = shiftedGfm || shiftedBfm ? 'cyan' : 'violet';

  const riskTone: Tone | undefined =
    typeof stats?.zAbs === 'number' && Math.abs(stats.zAbs) >= 2 ? 'bad' : undefined;

  const topTiles: Array<{ label: string; value: React.ReactNode; sub?: React.ReactNode; tone?: Tone }> = [
    {
      label: 'price',
      value: fmtNum(live?.benchmark),
      sub: `24h ${fmtPct(t24)} | drv ${fmtPct(live?.pct_drv)}`,
      tone: toneForNumber(live?.pct_drv),
    },
    {
      label: 'gfm',
      value: fmtNum(stats?.gfmAbs),
      sub: `ref ${fmtNum(stats?.refGfmAbs)} | delta ${fmtNum(stats?.deltaGfmAbs)} (${fmtPct(stats?.deltaGfmPct)})`,
      tone: toneForNumber(stats?.deltaGfmPct),
    },
    {
      label: 'bfm',
      value: fmtNum(stats?.bfm01),
      sub: `ref ${fmtNum(stats?.refBfm01)} | delta ${fmtNum(stats?.deltaBfm01)} (${fmtPct(stats?.deltaBfmPct)})`,
      tone: toneForNumber(stats?.deltaBfmPct),
    },
    {
      label: 'sigma / |z|',
      value: fmtNum(stats?.sigma),
      sub: `|z| ${fmtNum(stats?.zAbs)}`,
      tone: riskTone,
    },
  ];

  const floMoItems: MetricItem[] = [
    { label: 'abs', value: fmtNum(stats?.gfmAbs), tone: toneForNumber(stats?.gfmAbs) },
    { label: 'ref', value: fmtNum(stats?.refGfmAbs) },
    { label: 'delta', value: fmtNum(stats?.deltaGfmAbs), tone: toneForNumber(stats?.deltaGfmAbs) },
    { label: 'delta %', value: fmtPct(stats?.deltaGfmPct), tone: toneForNumber(stats?.deltaGfmPct) },
    { label: 'shifted', value: shiftedGfm ? 'yes' : 'no', tone: shiftedGfm ? 'good' : 'muted' },
  ];

  const bFloMItems: MetricItem[] = [
    { label: 'bfm', value: fmtNum(stats?.bfm01), tone: toneForNumber(stats?.bfm01) },
    { label: 'ref', value: fmtNum(stats?.refBfm01) },
    { label: 'delta', value: fmtNum(stats?.deltaBfm01), tone: toneForNumber(stats?.deltaBfm01) },
    { label: 'delta %', value: fmtPct(stats?.deltaBfmPct), tone: toneForNumber(stats?.deltaBfmPct) },
    { label: 'shifted', value: shiftedBfm ? 'yes' : 'no', tone: shiftedBfm ? 'good' : 'muted' },
  ];

  const priceItems: MetricItem[] = [
    { label: 'opening', value: fmtNum(open?.benchmark) },
    { label: 'last', value: fmtNum(stats?.last) },
    { label: 'prev', value: fmtNum(stats?.prev) },
    { label: 'min', value: fmtNum(extrema.priceMin) },
    { label: 'max', value: fmtNum(extrema.priceMax) },
    { label: 'bench min %', value: fmtPct(extrema.benchPctMin) },
    { label: 'bench max %', value: fmtPct(extrema.benchPctMax) },
    { label: '24h', value: fmtPct(t24) },
  ];

  const vectorItems: MetricItem[] = [
    { label: 'vInner', value: fmtNum(stats?.vInner) },
    { label: 'vOuter', value: fmtNum(stats?.vOuter) },
    { label: 'tendency score', value: fmtNum(stats?.tendency?.score), tone: toneForNumber(stats?.tendency?.score) },
    { label: 'direction', value: fmtNum(stats?.tendency?.direction) },
    { label: 'strength', value: fmtNum(stats?.tendency?.strength) },
    { label: 'slope', value: fmtNum(stats?.tendency?.slope) },
    { label: 'correlation', value: fmtNum(stats?.tendency?.r) },
    { label: 'vSwap score', value: fmtNum(vSwap?.score), tone: toneForNumber(vSwap?.score) },
    { label: 'vSwap Q', value: fmtNum(vSwap?.Q) },
    { label: 'vSwap q1', value: fmtNum(vSwap?.q1) },
    { label: 'vSwap q3', value: fmtNum(vSwap?.q3) },
  ];

  const toolboxItems: MetricItem[] = [
    { label: 'inertia static', value: fmtNum(stats?.inertia?.static) },
    { label: 'inertia growth', value: fmtNum(stats?.inertia?.growth) },
    { label: 'inertia total', value: fmtNum(stats?.inertia?.total) },
    { label: 'face', value: stats?.inertia?.face ?? '-', tone: stats?.inertia?.face === 'growth' ? 'good' : stats?.inertia?.face === 'static' ? 'muted' : undefined },
    { label: 'amp', value: fmtNum(stats?.amp) },
    { label: 'volt', value: fmtNum(stats?.volt) },
    { label: 'efficiency', value: fmtPct(stats?.efficiency) },
  ];

  const metaItems: MetricItem[] = [
    { label: 'window', value: row.window },
    { label: 'observations', value: Number.isFinite(row.n) ? String(row.n) : '-' },
    { label: 'bins', value: Number.isFinite(bins) ? String(bins) : '-' },
    { label: 'epoch', value: meta?.uiEpoch != null ? `#${meta.uiEpoch}` : '-' },
    { label: 'eps', value: fmtPlainPct(meta?.epsPct) },
    { label: 'k cycles', value: meta?.kCycles != null ? String(meta.kCycles) : '-' },
    { label: 'shifts', value: shifts?.nShifts != null ? String(shifts.nShifts) : '-' },
    { label: 'latest shift', value: fmtTime(shifts?.latestTs) },
    { label: 'updated', value: fmtTime(latestTs) },
  ];

  const headerMetaParts = [
    meta?.uiEpoch != null ? `epoch #${meta.uiEpoch}` : null,
    meta?.epsPct != null ? `eps ${fmtPlainPct(meta.epsPct)}` : null,
    meta?.kCycles != null ? `k ${meta.kCycles}` : null,
  ].filter(Boolean) as string[];
  const headerMeta = headerMetaParts.join(' | ');

  const cardBorder = shiftedGfm || shiftedBfm ? 'rgba(103,232,249,0.45)' : 'rgba(99,102,241,0.4)';

  return (
    <div
      style={{
        display: 'grid',
        gap: 14,
        padding: '16px 18px',
        borderRadius: 14,
        background: 'linear-gradient(165deg, rgba(17,24,39,0.96), rgba(7,12,24,0.92))',
        border: `1px solid ${cardBorder}`,
        boxShadow: '0 18px 35px rgba(8,15,35,0.55)',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
        <div style={{ display: 'grid', gap: 4 }}>
 </div></div> </div>{ sym: string; row: ApiOut['out'][string] | undefined; bins: number }) {
  if (!row) {
    return (
      <div style={{
        padding: 16,
        borderRadius: 14,
        border: '1px solid rgba(234,179,8,0.45)',
        background: 'rgba(43,27,10,0.6)',
        display: 'grid',
        gap: 6
      }}>
        <strong style={{ fontSize: 16 }}>{sym}</strong>
        <div style={{ opacity: 0.75, fontSize: 12 }}>no data</div>
      </div>
    );
  }
  if (!row.ok) {
    return (
      <div style={{
        padding: 16,
        borderRadius: 14,
        border: '1px solid rgba(234,179,8,0.45)',
        background: 'rgba(43,27,10,0.6)',
        display: 'grid',
        gap: 6
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <strong style={{ fontSize: 16 }}>{sym}</strong>
          <span style={{ opacity: 0.7, fontSize: 12 }}>{row?.error ?? 'unavailable'}</span>
        </div>
      </div>
    );
  }

  const stats = row.stats;
  const open = row.cards?.opening;
  const live = row.cards?.live;
  const ex = row.extrema ?? {};
  const t24 = live?.pct24h ?? open?.pct24h;
  const { base, quote } = splitSymbol(sym);
  const meta = row.meta;
  const shifts = row.shifts;
  const histCounts = row.hist?.counts ?? [];
  const streams = row.streams?.stamps ?? [];
  const shiftedGfm = !!stats?.shiftedGfm;
  const shiftedBfm = !!stats?.shiftedBfm;
  const latestTs = row.lastUpdateTs ?? shifts?.latestTs ?? null;
  const vSwap = stats?.vSwap ?? null;

  const riskTone: Tone | undefined = typeof stats?.zAbs === 'number' && Math.abs(stats.zAbs) >= 2 ? 'bad' : undefined;
  const topTiles: Array<{ label: string; value: React.ReactNode; sub?: React.ReactNode; tone?: Tone }> = [
    {
      label: 'price',
      value: fmtNum(live?.benchmark),
      sub: `24h ${fmtPct(t24)} • drv ${fmtPct(live?.pct_drv)}`,
      tone: toneForNumber(live?.pct_drv)
    },
    {
      label: 'gfm',
      value: fmtNum(stats?.gfmAbs),
      sub: `ref ${fmtNum(stats?.refGfmAbs)} • Δ ${fmtNum(stats?.deltaGfmAbs)} (${fmtPct(stats?.deltaGfmPct)})`,
      tone: toneForNumber(stats?.deltaGfmPct)
    },
    {
      label: 'bfm',
      value: fmtNum(stats?.bfm01),
      sub: `ref ${fmtNum(stats?.refBfm01)} • Δ ${fmtNum(stats?.deltaBfm01)} (${fmtPct(stats?.deltaBfmPct)})`,
      tone: toneForNumber(stats?.deltaBfmPct)
    },
    {
      label: 'σ / |z|',
      value: fmtNum(stats?.sigma),
      sub: `|z| ${fmtNum(stats?.zAbs)}`,
      tone: riskTone
    }
  ];

  const floMoItems: MetricItem[] = [
    { label: 'abs', value: fmtNum(stats?.gfmAbs), tone: toneForNumber(stats?.gfmAbs) },
    { label: 'ref', value: fmtNum(stats?.refGfmAbs) },
    { label: 'Δ', value: fmtNum(stats?.deltaGfmAbs), tone: toneForNumber(stats?.deltaGfmAbs) },
    { label: 'Δ %', value: fmtPct(stats?.deltaGfmPct), tone: toneForNumber(stats?.deltaGfmPct) },
    { label: 'shifted', value: shiftedGfm ? 'yes' : 'no', tone: shiftedGfm ? 'good' : 'muted' }
  ];

  const bFloMItems: MetricItem[] = [
    { label: 'bfm', value: fmtNum(stats?.bfm01), tone: toneForNumber(stats?.bfm01) },
    { label: 'ref', value: fmtNum(stats?.refBfm01) },
    { label: 'Δ', value: fmtNum(stats?.deltaBfm01), tone: toneForNumber(stats?.deltaBfm01) },
    { label: 'Δ %', value: fmtPct(stats?.deltaBfmPct), tone: toneForNumber(stats?.deltaBfmPct) },
    { label: 'shifted', value: shiftedBfm ? 'yes' : 'no', tone: shiftedBfm ? 'good' : 'muted' }
  ];

  const priceItems: MetricItem[] = [
    { label: 'opening', value: fmtNum(open?.benchmark) },
    { label: 'last', value: fmtNum(stats?.last) },
    { label: 'prev', value: fmtNum(stats?.prev) },
    { label: 'min', value: fmtNum(ex.priceMin) },
    { label: 'max', value: fmtNum(ex.priceMax) },
    { label: 'bench min %', value: fmtPct(ex.benchPctMin) },
    { label: 'bench max %', value: fmtPct(ex.benchPctMax) },
    { label: '24h', value: fmtPct(t24) }
  ];

  const vectorItems: MetricItem[] = [
    { label: 'vInner', value: fmtNum(stats?.vInner) },
    { label: 'vOuter', value: fmtNum(stats?.vOuter) },
    { label: 'tendency score', value: fmtNum(stats?.tendency?.score), tone: toneForNumber(stats?.tendency?.score) },
    { label: 'direction', value: fmtNum(stats?.tendency?.direction) },
    { label: 'strength', value: fmtNum(stats?.tendency?.strength) },
    { label: 'slope', value: fmtNum(stats?.tendency?.slope) },
    { label: 'correlation', value: fmtNum(stats?.tendency?.r) },
    { label: 'vSwap score', value: fmtNum(vSwap?.score), tone: toneForNumber(vSwap?.score) },
    { label: 'vSwap Q', value: fmtNum(vSwap?.Q) },
    { label: 'vSwap q1', value: fmtNum(vSwap?.q1) },
    { label: 'vSwap q3', value: fmtNum(vSwap?.q3) }
  ];

  const toolboxItems: MetricItem[] = [
    { label: 'inertia static', value: fmtNum(stats?.inertia?.static) },
    { label: 'inertia growth', value: fmtNum(stats?.inertia?.growth) },
    { label: 'inertia total', value: fmtNum(stats?.inertia?.total) },
    { label: 'face', value: stats?.inertia?.face ?? '—', tone: stats?.inertia?.face === 'growth' ? 'good' : stats?.inertia?.face === 'static' ? 'muted' : undefined },
    { label: 'amp', value: fmtNum(stats?.amp) },
    { label: 'volt', value: fmtNum(stats?.volt) },
    { label: 'efficiency', value: fmtPct(stats?.efficiency) }
  ];

  const metaItems: MetricItem[] = [
    { label: 'window', value: row.window },
    { label: 'observations', value: row.n != null ? String(row.n) : '—' },
    { label: 'bins', value: String(bins) },
    { label: 'epoch', value: meta?.uiEpoch != null ? `#${meta.uiEpoch}` : '—' },
    { label: 'eps', value: fmtPlainPct(meta?.epsPct) },
    { label: 'k cycles', value: meta?.kCycles != null ? String(meta.kCycles) : '—' },
    { label: 'shifts', value: shifts?.nShifts != null ? String(shifts.nShifts) : '—' },
    { label: 'latest shift', value: fmtTime(shifts?.latestTs) },
    { label: 'updated', value: fmtTime(latestTs) }
  ];

  const headerMeta = [
    meta?.uiEpoch != null ? `epoch #${meta.uiEpoch}` : null,
    meta?.epsPct != null ? `eps ${fmtPlainPct(meta.epsPct)}` : null,
    meta?.kCycles != null ? `k ${meta.kCycles}` : null
  ].filter(Boolean).join(' • ');

  const cardBorder = shiftedGfm || shiftedBfm ? 'rgba(103,232,249,0.45)' : 'rgba(99,102,241,0.4)';

  return (
    <div style={{
      display: 'grid',
      gap: 14,
      padding: '16px 18px',
      borderRadius: 14,
      background: 'linear-gradient(165deg, rgba(17,24,39,0.96), rgba(7,12,24,0.92))',
      border: `1px solid ${cardBorder}`,
      boxShadow: '0 18px 35px rgba(8,15,35,0.55)'
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
        <div style={{ display: 'grid', gap: 4 }}>
          <strong style={{ fontSize: 18, letterSpacing: 0.3 }}>{sym}</strong>
          <div style={{ fontSize: 12, opacity: 0.65 }}>{base}/{quote}</div>
        </div>
        <div style={{ display: 'grid', gap: 4, textAlign: 'right', fontSize: 11, opacity: 0.75 }}>
          <div>{`window ${row.window} • n=${row.n} • bins=${bins}`}</div>
          {headerMeta ? <div>{headerMeta}</div> : null}
          <div>{`updated ${fmtTime(latestTs)}`}</div>
        </div>
      </div>

      <div style={{ display: 'grid', gap: 10, gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))' }}>
        {topTiles.map((tile, idx) => (
          <MetricTile
            key={`${sym}-top-${idx}`}
            label={tile.label.toUpperCase()}
            value={tile.value}
            sub={tile.sub}
            tone={tile.tone}
          />
        ))}
      </div>

      <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))' }}>
        <SectionBox title="FloMo" subtitle={shiftedGfm ? 'shifted' : undefined}>
          <MetricGrid items={floMoItems} columns={2} />
        </SectionBox>
        <SectionBox title="BFloM" subtitle={shiftedBfm ? 'shifted' : undefined}>
          <MetricGrid items={bFloMItems} columns={2} />
        </SectionBox>
        <SectionBox title="Price & Extrema">
          <MetricGrid items={priceItems} columns={2} />
        </SectionBox>
        <SectionBox title="Vectors">
          <MetricGrid items={vectorItems} columns={2} />
        </SectionBox>
        <SectionBox title="Toolbox">
          <MetricGrid items={toolboxItems} columns={2} />
        </SectionBox>
        <SectionBox title="Shifts & Meta">
          <MetricGrid items={metaItems} columns={2} />
        </SectionBox>
      </div>

      {(histCounts.length || streams.length) && (
        <div style={{ display: 'grid', gap: 12, gridTemplateColumns: histCounts.length && streams.length ? 'repeat(auto-fit, minmax(280px, 1fr))' : 'minmax(0, 1fr)' }}>
          {histCounts.length ? (
            <SectionBox title="Histogram" subtitle={`${histCounts.length} bins`}>
              <MiniBars counts={histCounts} height={70} />
            </SectionBox>
          ) : null}
          {streams.length ? (
            <SectionBox title="Streams" subtitle={`last ${Math.min(12, streams.length)} / ${row.streams?.maxStamps ?? streams.length}`}>
              <StreamsTable stamps={streams} />
            </SectionBox>
          ) : null}
        </div>
      )}

      {row.db_error && (
        <SectionBox title="db error">
          <div style={{ fontSize: 12, color: '#fca5a5' }}>{row.db_error}</div>
        </SectionBox>
      )}
    </div>
  );
}
/* ---------- symbol card ---------- */
type SymbolPanelProps = {
  sym: string;
  row: ApiOut['out'][string] | undefined;
  bins: number;
};

function SymbolPanel({ sym, row, bins }: SymbolPanelProps) {
  if (!row) {
    return (
      <div style={{ padding: 8, opacity: 0.6 }}>
        No data for <code>{sym}</code>
      </div>
    );
  }

  // keep all your current derived consts here:
  // e.g. const shiftedGfm = ...
  // const shiftedBfm = ...
  // const headerMeta = ...
  // const topTiles = [...]
  // const floMoItems = [...]
  // const bFloMItems = [...]
  // const priceItems = [...]
  // const vectorItems = [...]
  // const toolboxItems = [...]
  // const metaItems = [...]
  // const histCounts = ...
  // const histNuclei = ...
  // const histogramAccent = ...
  // const streams = ...
  // const latestTs = ...
