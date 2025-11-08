// src/app/api/str-aux/samples/route.ts
import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import {
  getSamplingStore,
  orderedWindowKeys,
  summarizeMark,
  summarizeWindowMarkers,
} from '@/core/features/str-aux/sampling';
import type { SamplingHealthStatus, SamplingWindowKey } from '@/core/features/str-aux/sampling';
import { resolveCoinsFromSettings } from '@/lib/settings/server';
import { dedupeCoins, normalizeCoin } from '@/lib/markets/pairs';

type WindowKey = SamplingWindowKey;

const U = (x: unknown) => String(x ?? '').trim().toUpperCase();
const KNOWN_QUOTES = ['USDT','BTC','ETH','BNB','BUSD','FDUSD','USDC','TUSD'] as const;

function splitSymbol(sym: string): { base: string; quote: string } {
  const S = U(sym);
  for (const q of KNOWN_QUOTES) if (S.endsWith(q) && S.length > q.length) return { base: S.slice(0, -q.length), quote: q };
  return { base: S.replace(/USDT$/i, ''), quote: 'USDT' };
}

async function getPreviewSymbols(origin: string): Promise<string[]> {
  try {
    const r = await fetch(`${origin}/api/preview/symbols`, { cache: 'no-store' });
    if (!r.ok) return [];
    const j = await r.json() as any;
    return Array.isArray(j?.symbols) ? j.symbols.map(U) : [];
  } catch { return []; }
}
async function getSettingsSymbols(origin: string): Promise<string[]> {
  try {
    const r = await fetch(`${origin}/api/preview/universe/symbols`, { cache: 'no-store' });
    if (!r.ok) return [];
    const j = await r.json() as any;
    return Array.isArray(j?.symbols) ? j.symbols.map(U) : [];
  } catch { return []; }
}
async function resolveBasesFromSettings(origin: string): Promise<string[]> {
  const fromSettings = dedupeCoins(await resolveCoinsFromSettings()).filter((c) => c !== 'USDT');
  if (fromSettings.length) return fromSettings;

  const setSyms = await getSettingsSymbols(origin);
  if (setSyms.length) {
    const bases = dedupeCoins(setSyms.map((s) => splitSymbol(s).base)).filter((c) => c !== 'USDT');
    if (bases.length) return bases;
  }

  const uniSyms = await getPreviewSymbols(origin);
  if (uniSyms.length) {
    const bases = dedupeCoins(uniSyms.map((s) => splitSymbol(s).base)).filter((c) => c !== 'USDT');
    if (bases.length) return bases;
  }

  const env = U(process.env.NEXT_PUBLIC_COINS ?? '');
  const envBases = env
    ? dedupeCoins(env.split(/[,\s]+/).filter(Boolean)).filter((c) => c !== 'USDT')
    : [];
  if (envBases.length) return envBases;

  return dedupeCoins(['BTC','ETH','BNB','SOL','ADA','XRP','DOGE']).filter((c) => c !== 'USDT');
}

function toUSDT(symOrBase: string) {
  const base = normalizeCoin(symOrBase);
  if (!base) return '';
  return base === 'USDT' ? 'USDT' : `${base}USDT`;
}

async function resolveSymbols(url: URL): Promise<string[]> {
  const symQ = url.searchParams.get('symbols');
  if (symQ && symQ.trim()) {
    return Array.from(new Set(symQ.split(',').map(U).filter(s => /^[A-Z0-9]{5,20}$/.test(s))));
  }
  const q = url.searchParams.get('bases');
  if (q && q.trim()) {
    return Array.from(new Set(q.split(',').map(toUSDT).filter(Boolean)));
  }
  const bases = await resolveBasesFromSettings(url.origin);
  return Array.from(new Set(bases.map(toUSDT).filter(Boolean)));
}

const windows = orderedWindowKeys();

type WindowSummaryOut = {
  capacity: number;
  size: number;
  statusCounts: Record<SamplingHealthStatus, number>;
  markers: ReturnType<typeof summarizeWindowMarkers>;
};

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const symbols = await resolveSymbols(url);
    const shouldCollect = (url.searchParams.get('collect') ?? '1') !== '0';
    const sampler = getSamplingStore();
    const now = Date.now();

    if (!symbols.length) {
      return NextResponse.json({ ok: true, symbols: [], out: {}, ts: now });
    }

    const out: Record<string, any> = {};

    for (const symbol of symbols) {
      if (shouldCollect) {
        try { await sampler.collect(symbol); } catch { /* swallow sampling errors, snapshot still available */ }
      }
      const snapshot = sampler.snapshot(symbol);

      const windowData = Object.fromEntries(
        windows.map((key) => {
          const summary = snapshot.windows[key];
          const value: WindowSummaryOut = {
            capacity: summary.capacity,
            size: summary.size,
            statusCounts: summary.statusCounts,
            markers: summarizeWindowMarkers(summary),
          };
          return [key, value];
        }),
      ) as Record<WindowKey, WindowSummaryOut>;

      out[symbol] = {
        ok: true,
        cycle: snapshot.cycle,
        windows: windowData,
        lastPoint: snapshot.lastPoint,
        lastClosedMark: snapshot.lastClosedMark ? summarizeMark(snapshot.lastClosedMark) : null,
        historySize: snapshot.historySize,
      };
    }

    return NextResponse.json({ ok: true, symbols, out, ts: now });
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: String(err?.message ?? err) }, { status: 500 });
  }
}


// /api/str-aux/sampling (POST)
import { query } from "@/core/db/pool_server";

export async function POST(req: Request) {
  const body = await req.json();
  // expected shape: { symbol, ts, metrics: { v_inner, v_outer, ... } }
  const { symbol, ts, metrics } = body;

  // sanity
  if (!symbol || !ts) return new Response("bad request", { status: 400 });

  // 1️⃣ upsert 5 s sample
  await query(
    `select str_aux.upsert_sample_5s($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
    [
      symbol,
      ts,
      metrics.v_inner,
      metrics.v_outer,
      metrics.v_swap,
      metrics.v_tendency,
      metrics.disruption,
      metrics.amp,
      metrics.volt,
      metrics.inertia,
      metrics.mode_general,
      metrics.mode_b,
      metrics.attrs ?? {},
    ]
  );

  // 2️⃣ auto-roll latest cycle & windows
  await query(`select str_aux.sp_roll_cycle_40s($1, str_aux._floor_to_seconds($2, 40))`, [
    symbol,
    ts,
  ]);

  // 3️⃣ roll windows (30 m / 1 h / 3 h) if boundaries cross
  for (const w of ["30m", "1h", "3h"]) {
    await query(`select str_aux.try_roll_window_now($1,$2)`, [symbol, w]);
  }

  return new Response(JSON.stringify({ ok: true }), { status: 200 });
}

