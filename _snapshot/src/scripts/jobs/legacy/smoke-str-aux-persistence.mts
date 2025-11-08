// src/scripts/smokes/smoke-str-aux-persistence.mts
import 'dotenv/config';

const origin = process.env.ORIGIN || 'http://localhost:3000';
const symbolsEnv = process.env.STR_AUX_SYMBOLS || 'BTCUSDT,ETHUSDT';
const windowEnv = process.env.STR_AUX_WINDOW || '30m';
const epsEnv = process.env.STR_AUX_EPS || '0.35';
const sessionId = (process.env.STR_AUX_SESSION || 'ui').slice(0, 64);

const symbols = Array.from(new Set(symbolsEnv.split(',').map((s) => s.trim()).filter(Boolean)));

function fmt(n: unknown, digits = 4) {
  if (typeof n !== 'number' || !Number.isFinite(n)) return '-';
  return n.toFixed(digits);
}

async function jsonFetch(url: string) {
  const res = await fetch(url, { headers: { 'cache-control': 'no-store' } });
  const txt = await res.text();
  try {
    return { ok: res.ok, status: res.status, json: JSON.parse(txt) } as const;
  } catch {
    return { ok: res.ok, status: res.status, text: txt } as const;
  }
}

(async () => {
  console.log([str-aux] origin= symbols=);
  const statsUrl = ${origin}/api/str-aux/stats?symbols=&window=&eps=;
  const statsRes = await jsonFetch(statsUrl);
  console.log('[str-aux] GET /api/str-aux/stats', statsRes.status, statsRes.ok ? 'OK' : 'ERR');
  if (!statsRes.ok || !('json' in statsRes)) {
    console.error(statsRes.text ?? 'no payload');
    process.exit(1);
  }

  const data = statsRes.json;
  for (const sym of symbols) {
    const row = data?.out?.[sym];
    if (!row?.ok) {
      console.warn(  [] missing or error, row?.error ?? row);
      continue;
    }
    const stats = row.stats;
    const fm = row.fm ?? {};
    const metrics = {
      gfm: fmt(stats?.gfmAbs),
      bfm: fmt(stats?.bfm01),
      vInner: fmt(stats?.vInner),
      vOuter: fmt(stats?.vOuter),
      vSwap: fmt(stats?.vSwap?.score),
      tendency: fmt(stats?.tendency?.score),
      inertia: fmt(stats?.inertia ?? fm.inertia),
      disruption: fmt(fm.disruption ?? null),
    };
    console.log(  [], metrics);
  }

  const shiftsUrl = ${origin}/api/str-aux/shifts?sessionId=&symbols=;
  const shiftsRes = await jsonFetch(shiftsUrl);
  console.log('[str-aux] GET /api/str-aux/shifts', shiftsRes.status, shiftsRes.ok ? 'OK' : 'ERR');
  if ('json' in shiftsRes) {
    const items = shiftsRes.json?.items ?? [];
    for (const item of items) {
      console.log(  [shift:] streak= delta=);
    }
  }
})();
