// src/app/api/str-aux/bins/route.ts
// Legacy compatibility shim so old callers still work.
// Proxies to /api/str-aux/stats and returns the same payload plus "pairs" (alias of "symbols").

import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

function up(s: unknown) { return String(s ?? '').trim().toUpperCase(); }

function mapQuery(oldUrl: URL) {
  // old used ?coins=BTC,ETH,SOL ; new uses ?bases=
  const basesQ = oldUrl.searchParams.get('bases')
    ?? oldUrl.searchParams.get('coins')
    ?? '';

  const pairsQ = oldUrl.searchParams.get('pairs') ?? '';

  const p = new URLSearchParams();
  const windowQ = oldUrl.searchParams.get('window') ?? '30m';
  const binsQ   = oldUrl.searchParams.get('bins') ?? '128';
  const sessQ   = oldUrl.searchParams.get('sessionId') ?? 'ui';
  const epsQ    = oldUrl.searchParams.get('eps') ?? '';
  const kQ      = oldUrl.searchParams.get('k') ?? '';

  if (basesQ) p.set('bases', basesQ.split(',').map(up).join(','));
  if (pairsQ) p.set('symbols', pairsQ.split(',').map(up).join(','));
  p.set('window', windowQ);
  p.set('bins', binsQ);
  p.set('sessionId', sessQ);
  if (epsQ) p.set('eps', epsQ);
  if (kQ) p.set('k', kQ);

  return p.toString();
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const qs = mapQuery(url);
    const r = await fetch(`${url.origin}/api/str-aux/stats?${qs}`, { cache: 'no-store' });
    const j = await r.json();
    const ok = (j && j.ok !== false);

    // add legacy 'pairs' alias so older UI still works
    const body = ok ? { ...j, pairs: Array.isArray(j.symbols) ? j.symbols : [] } : j;
    return NextResponse.json(body, { status: r.status, headers: { 'Cache-Control': 'no-store' } });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message ?? e) }, { status: 500, headers: { 'Cache-Control': 'no-store' } });
  }
}

export async function POST(req: Request) {
  try {
    const url = new URL(req.url);
    const body = (await req.json()) as { coins?: string[]; bases?: string[] } | null;
    const bases = (body?.bases ?? body?.coins ?? []).map(up).filter(Boolean);
    const p = new URLSearchParams(mapQuery(url));
    if (bases.length) p.set('bases', bases.join(','));
    const r = await fetch(`${url.origin}/api/str-aux/stats?${p.toString()}`, { cache: 'no-store' });
    const j = await r.json();
    const ok = (j && j.ok !== false);
    const bodyOut = ok ? { ...j, pairs: Array.isArray(j.symbols) ? j.symbols : [] } : j;
    return NextResponse.json(bodyOut, { status: r.status, headers: { 'Cache-Control': 'no-store' } });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message ?? e) }, { status: 500, headers: { 'Cache-Control': 'no-store' } });
  }
}
