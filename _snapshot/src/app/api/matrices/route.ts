import { NextResponse } from "next/server";
import { resolvePairAvailability, maskUnavailableMatrix } from "@/lib/markets/availability";
import type { PairAvailabilitySnapshot } from "@/lib/markets/availability";

/* ---------- utils ---------- */
const U = (s: unknown) => String(s ?? "").trim().toUpperCase();
const KNOWN_QUOTES = ["USDT", "FDUSD", "USDC", "TUSD", "BUSD"] as const;
type WindowKey = "15m" | "30m" | "1h";

function parseWindow(w: string | null): WindowKey {
  const s = String(w ?? "30m").toLowerCase();
  return (s === "15m" || s === "1h") ? (s as WindowKey) : "30m";
}

function parseCSV(x: string | null): string[] {
  return (x ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map(U);
}

function mkOrigin(req: Request) {
  const u = new URL(req.url);
  return `${u.protocol}//${u.host}`;
}

function splitSymbol(sym: string): { base: string; quote: string } {
  const S = U(sym);
  for (const q of KNOWN_QUOTES) {
    if (S.endsWith(q) && S.length > q.length) {
      return { base: S.slice(0, -q.length), quote: q };
    }
  }
  return { base: S.replace(/USDT$/i, ""), quote: "USDT" };
}

/* ---------- inputs from sibling endpoints ---------- */

async function getSettingsCoins(origin: string): Promise<string[]> {
  // tries several shapes we've seen across branches: { coinUniverse: [...] } or { coins: [...] }
  try {
    const r = await fetch(`${origin}/api/settings`, { cache: "no-store" });
    if (!r.ok) return [];
    const j = await r.json();
    const candidates = [j, j?.settings];
    for (const candidate of candidates) {
      if (!candidate) continue;
      if (Array.isArray(candidate?.coinUniverse)) return candidate.coinUniverse.map(U);
      if (Array.isArray(candidate?.coins)) return candidate.coins.map(U);
    }
  } catch {}
  return [];
}

async function getPreviewSymbols(origin: string): Promise<string[]> {
  // tries /preview/symbols first, then /preview, supports both array and {symbols:[...]}
  const tryOne = async (url: string) => {
    try {
      const r = await fetch(url, { cache: "no-store" });
      if (!r.ok) return [] as string[];
      const j = await r.json();
      if (Array.isArray(j)) return j.map(U);
      if (Array.isArray(j?.symbols)) return j.symbols.map(U);
      return [];
    } catch { return []; }
  };
  const a = await tryOne(`${origin}/api/preview/universe/symbols`);
  if (a.length) return a;
  const b = await tryOne(`${origin}/api/preview/symbols`);
  return b;
}

type KlineRow = { ts: number; open?: number; high?: number; low?: number; close?: number; price?: number };

async function loadSeries(origin: string, symbol: string, windowKey: WindowKey): Promise<KlineRow[]> {
  const qs = new URLSearchParams({ symbol, window: windowKey }).toString();

  // prefer klines
  try {
    const r = await fetch(`${origin}/api/market/klines?${qs}`, { cache: "no-store" });
    if (r.ok) {
      const j = await r.json();
      if (Array.isArray(j) && j.length) {
        if (Array.isArray(j[0])) {
          return j
            .map((row: any[]) => ({
              ts: Number(row[0]),
              open: Number(row[1]),
              high: Number(row[2]),
              low: Number(row[3]),
              close: Number(row[4]),
            }))
            .filter((x) => Number.isFinite(x.close));
        }
        return j
          .map((x: any) => ({
            ts: Number(x.ts),
            close: Number(x.close ?? x.price ?? x.c),
          }))
          .filter((x) => Number.isFinite(x.close));
      }
    }
  } catch {}

  // fallback ticks
  try {
    const r = await fetch(`${origin}/api/market/ticks?${qs}`, { cache: "no-store" });
    if (r.ok) {
      const j = await r.json();
      if (Array.isArray(j)) {
        return j
          .map((x: any) => ({
            ts: Number(x.ts ?? x[0]),
            close: Number(x.price ?? x[1]),
          }))
          .filter((x) => Number.isFinite(x.close));
      }
    }
  } catch {}

  return [];
}

/* ---------- per-symbol snapshot ---------- */

type SymSnap = {
  ok: boolean;
  error?: string;
  symbol: string;
  base: string;
  quote: string;
  opening: number;
  prev: number;
  last: number;
  ref: number;
  id_pct: number; // % (0..100)
  pct_drv: number; // % (0..100)
  pct_ref: number; // % (0..100)
};

function calcSymMetrics(symbol: string, rows: KlineRow[]): SymSnap {
  const { base, quote } = splitSymbol(symbol);
  if (!rows.length) {
    return {
      ok: false,
      error: "no series",
      symbol,
      base,
      quote,
      opening: NaN,
      prev: NaN,
      last: NaN,
      ref: NaN,
      id_pct: NaN,
      pct_drv: NaN,
      pct_ref: NaN,
    };
  }
  const opening = Number(rows[0].close ?? rows[0].open ?? rows[0].price);
  const last = Number(rows[rows.length - 1].close ?? rows[rows.length - 1].price);
  const prev = Number(
    rows[rows.length - 2]?.close ?? rows[rows.length - 2]?.price ?? rows[rows.length - 1].close
  );
  const ref = opening;

  const id_pct = opening > 0 ? (last / opening - 1) * 100 : NaN;
  const pct_drv = prev > 0 ? (last / prev - 1) * 100 : NaN;
  const pct_ref = ref > 0 ? (last / ref - 1) * 100 : NaN;

  return { ok: true, symbol, base, quote, opening, prev, last, ref, id_pct, pct_drv, pct_ref };
}

/* ---------- matrix builders ---------- */

function buildBenchmarkMatrix(
  bases: string[],
  priceMap: Record<string, number>
): Record<string, Record<string, number>> {
  const M: Record<string, Record<string, number>> = {};
  for (const a of bases) {
    const row: Record<string, number> = {};
    const pa = priceMap[a];
    for (const b of bases) {
      const pb = priceMap[b];
      row[b] = Number.isFinite(pa) && Number.isFinite(pb) && pb > 0 ? pa / pb : NaN;
    }
    M[a] = row;
  }
  return M;
}

function buildDeltaMatrix(
  bases: string[],
  lastMap: Record<string, number>,
  prevMap: Record<string, number>
): Record<string, Record<string, number>> {
  const D: Record<string, Record<string, number>> = {};
  for (const a of bases) {
    const row: Record<string, number> = {};
    for (const b of bases) {
      const pa = lastMap[a],
        pb = lastMap[b];
      const pa0 = prevMap[a],
        pb0 = prevMap[b];
      const v = Number.isFinite(pa) && Number.isFinite(pb) && pb > 0 ? pa / pb : NaN;
      const v0 = Number.isFinite(pa0) && Number.isFinite(pb0) && pb0 > 0 ? pa0 / pb0 : NaN;
      row[b] = Number.isFinite(v) && Number.isFinite(v0) ? v - v0 : NaN;
    }
    D[a] = row;
  }
  return D;
}

/* ---------- main route ---------- */

export async function GET(req: Request) {
  const origin = mkOrigin(req);
  const url = new URL(req.url);
  const windowKey = parseWindow(url.searchParams.get("window"));
  const quote = U(url.searchParams.get("quote") || "USDT");
  const rawCoins = parseCSV(url.searchParams.get("coins")); // bases
  const rawSyms = parseCSV(url.searchParams.get("symbols"));

  // 1) highest priority: explicit symbols (query)
  let symbols: string[] = rawSyms;

  // 2) explicit coins (query) -> symbols
  if (!symbols.length && rawCoins.length) {
    symbols = rawCoins.map((b) => `${U(b)}${quote}`);
  }

  // 3) settings coin universe -> symbols
  const settingsCoins = await getSettingsCoins(origin);
  if (!symbols.length && settingsCoins.length) {
    symbols = settingsCoins
      .filter((c) => c !== quote)
      .map((b) => `${b}${quote}`);
  }

  // 4) preview symbols (already BASE+QUOTE) filtered by chosen quote
  if (!symbols.length) {
    const prevSyms = await getPreviewSymbols(origin);
    if (prevSyms.length) {
      symbols = prevSyms.filter((s) => splitSymbol(s).quote === quote);
    }
  }

  // 5) last-resort fallback (keeps UI functional if everything else is empty)
  if (!symbols.length) {
    symbols = ["BTCUSDT", "ETHUSDT", "BNBUSDT", "SOLUSDT", "ADAUSDT"];
  }

  // de-dup & cap
  symbols = Array.from(new Set(symbols.map(U))).slice(0, 30);

  // load series concurrently
  const snaps: SymSnap[] = await Promise.all(
    symbols.map(async (sym) => {
      const rows = await loadSeries(origin, sym, windowKey);
      return calcSymMetrics(sym, rows);
    })
  );

  const good = snaps.filter(
    (s) => s.ok && s.quote === quote && Number.isFinite(s.last)
  );

  const coinUniverse = Array.from(
    new Set<string>([...good.map((s) => s.base), quote])
  );
  const availability: PairAvailabilitySnapshot = await resolvePairAvailability(
    coinUniverse
  );
  const allowedSymbols = availability.set;
  const filteredGood =
    allowedSymbols.size > 0
      ? good.filter((s) => allowedSymbols.has(s.symbol))
      : good;

  const bases = Array.from(new Set(filteredGood.map((s) => s.base)));

  const lastMap: Record<string, number> = {};
  const prevMap: Record<string, number> = {};
  for (const s of filteredGood) {
    lastMap[s.base] = s.last;
    prevMap[s.base] = s.prev;
  }

  const ts = Date.now();
  const benchmark = buildBenchmarkMatrix(bases, lastMap);
  const delta = buildDeltaMatrix(bases, lastMap, prevMap);

  if (allowedSymbols.size) {
    maskUnavailableMatrix(benchmark, allowedSymbols);
    maskUnavailableMatrix(delta, allowedSymbols);
  }

  const perSymbol: Record<
    string,
    Omit<SymSnap, "ok" | "error" | "base" | "quote">
  > = {};
  for (const s of filteredGood) {
    perSymbol[s.symbol] = {
      symbol: s.symbol,
      opening: s.opening,
      prev: s.prev,
      last: s.last,
      ref: s.ref,
      id_pct: s.id_pct,
      pct_drv: s.pct_drv,
      pct_ref: s.pct_ref,
    };
  }

  return NextResponse.json({
    ok: true,
    coins: bases,
    symbols: filteredGood.map((s) => s.symbol),
    window: windowKey,
    ts,
    matrices: {
      benchmark: { ts, values: benchmark },
      delta: { ts, values: delta },
    },
    perSymbol,
    availability: {
      symbols: availability.symbols,
      pairs: availability.pairs,
    },
  });
}

export const runtime = "nodejs";
