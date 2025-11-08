// src/app/api/str-aux/vectors/route.ts
// ============================================================================
// STR-AUX • VECTORS API (sampling + pairs-index + market/pairs integration)
// - GET:  Resolve symbols (query → market/pairs), sample via SamplingStore,
//         or accept inline CSV (?series_SYMBOL=100,101,103). Returns full,
//         non-dehydrated summaries (render-ready).
// - POST: (A) explicit points_map OR (B) sample via SamplingStore when
//         points_map is absent; optionally drive sampling cycles.
// ----------------------------------------------------------------------------
// Notes:
// • Math comes from "@/core/features/str-aux/vectors" (keep your functions there).
// • Symbol resolution uses /api/preview/universe/symbols; you can also wire your
//   resolveSymbolSelection() by uncommenting its import (see TODO).
// • Sampling uses your SamplingStore (fetches orderbook via binance source).
// ============================================================================

import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ---- Vector math (you maintain/extend these in your module) -----------------
import {
  computeVectorSummary,
  type VectorPoint,
  type VectorSummary,
} from "@/core/features/str-aux/vectors";

// ---- Sampling (your implementation) ----------------------------------------
import {
  getSamplingStore,
  DEFAULT_SAMPLER_CONFIG,
  summarizeSnapshotWindow,
  orderedWindowKeys,
  type SamplingWindowKey,
  type SamplingPoint,
} from "@/core/features/str-aux/sampling";

// ---- (Optional) Pairs Index resolver (uncomment & set real path if desired)
// import { resolveSymbolSelection } from "@/lib/markets/symbol-selection"; // TODO: adjust path

// =============================================================================
// Helpers (append-only)
// =============================================================================

/** Parse "symbols=BTCUSDT,ETHUSDT" into a clean uppercase array. */
function parseSymbols(url: URL): string[] {
  const s = url.searchParams.get("symbols");
  if (!s) return [];
  return s.split(",").map(v => v.trim().toUpperCase()).filter(Boolean);
}

/** Safe numeric params. */
const qInt = (url: URL, key: string, fallback: number) => {
  const v = Number(url.searchParams.get(key));
  return Number.isFinite(v) && v > 0 ? Math.floor(v) : fallback;
};
const qFloat = (url: URL, key: string, fallback: number) => {
  const v = Number(url.searchParams.get(key));
  return Number.isFinite(v) ? v : fallback;
};
const numOrNull = (x: unknown) => (Number.isFinite(x as number) ? (x as number) : null);

/** Inline CSV → VectorPoint[] (quick browser tests). */
function parseSeriesCSV(csv?: string | null): VectorPoint[] {
  if (!csv) return [];
  const nums = csv.split(",").map(t => Number(t.trim())).filter(Number.isFinite);
  return nums.map(price => ({ price }));
}

/** Neutral, renderable VectorSummary shape (no data, no crashes). */
function neutralSummary(bins = 128): VectorSummary {
  return {
    scale: 100,
    bins,
    samples: 0,
    inner: { scaled: 0, unitless: 0, weightSum: 0 },
    outer: { scaled: 0, unitless: 0, weightSum: 0 },
    tendency: {
      series: [],
      metrics: { score: 0, direction: 0, strength: 0, slope: 0, r: 0 },
    },
    swap: { score: 0, Q: 0, q1: 0, q3: 0 },
  } as unknown as VectorSummary;
}

// add at top
import { query } from "@/core/db/pool_server";

/** Fetch enabled symbols from DB (settings.coin_universe) */
async function getMarketSymbolsFromApi(origin: string): Promise<string[]> {
  try {
    const { rows } = await query(`
      SELECT symbol::text
      FROM settings.coin_universe
      WHERE COALESCE(enabled,true)=true
      ORDER BY symbol
    `);
    if (rows?.length) return rows.map(r => r.symbol.toUpperCase());
  } catch (err) {
    console.warn("⚠️ DB symbol fetch failed, using static fallback:", err);
  }
  return ["BTCUSDT","ETHUSDT","BNBUSDT","SOLUSDT","ADAUSDT"]; // safe last resort
}


/** Resolve symbols: query → pairs index (optional) → market/pairs → fallback. */
async function resolveSymbols(url: URL): Promise<string[]> {
  const explicit = parseSymbols(url);
  if (explicit.length) return explicit;

  // If you want to prefer your pairs-index resolver, uncomment this try/catch,
  // set the import path above, and return selection.symbols when available.
  // try {
  //   const sel = await resolveSymbolSelection(url, { quote: "USDT" });
  //   if (sel?.symbols?.length) return sel.symbols;
  // } catch (e) {
  //   console.warn("pairs-index resolver failed, using /api/preview/universe/symbols:", e);
  // }

  const origin = url.origin || (process.env.NEXT_PUBLIC_BASE_URL ?? "http://localhost:3000");
  return getMarketSymbolsFromApi(origin);
}

/** Convert SamplingPoint[] → VectorPoint[] (use mid as price). */
function toVectorPoints(points: SamplingPoint[]): VectorPoint[] {
  return (points ?? [])
    .map(p => ({ price: Number(p.mid) }))
    .filter(v => Number.isFinite(v.price));
}

/** Compute one symbol’s detail with your computeVectorSummary. */
function computeDetail(points: VectorPoint[], cfg: {
  bins: number; scale: number; tendencyWindow: number; tendencyNorm: "mad"|"stdev"; swapAlpha: number;
}) {
  if (!points.length) {
    return {
      vInner: 0, vOuter: 0, spread: 0,
      vTendency: { score: 0, direction: 0, strength: 0, slope: 0, r: 0 },
      vSwap: { score: 0, quartile: 0, q1: 0, q3: 0 },
      summary: neutralSummary(cfg.bins),
    };
  }
  const summary = computeVectorSummary(points, {
    bins: cfg.bins,
    scale: cfg.scale,
    history: { inner: [], tendency: [] },
    tendencyWindow: cfg.tendencyWindow,
    tendencyNorm: cfg.tendencyNorm,
    swapAlpha: cfg.swapAlpha,
  });

  const vInner = numOrNull(summary.inner?.scaled);
  const vOuter = numOrNull(summary.outer?.scaled);
  const spread = Number.isFinite(vOuter) && Number.isFinite(vInner) ? (vOuter as number) - (vInner as number) : 0;
  const tm = summary.tendency?.metrics ?? {};
  const vTendency = {
    score: numOrNull(tm.score),
    direction: numOrNull(tm.direction),
    strength: numOrNull(tm.strength),
    slope: numOrNull(tm.slope),
    r: numOrNull(tm.r),
  };
  const sw = summary.swap ?? {};
  const vSwap = {
    score: numOrNull((sw as any).score),
    quartile: numOrNull((sw as any).Q),
    q1: numOrNull((sw as any).q1),
    q3: numOrNull((sw as any).q3),
  };

  return { vInner, vOuter, spread, vTendency, vSwap, summary };
}

/** Drive the SamplingStore enough to populate a window, if requested. */
async function driveSampling(symbols: string[], opts: {
  window: SamplingWindowKey; cycles: number; force?: boolean;
}) {
  const store = getSamplingStore(DEFAULT_SAMPLER_CONFIG);
  // Collect a few cycles to ensure at least one closed mark (optional)
  const n = Math.max(0, Math.min(opts.cycles ?? 0, 50));
  for (let k = 0; k < n; k++) {
    await Promise.all(symbols.map(sym => store.collect(sym, { force: !!opts.force })));
    // tiny stagger helps avoid rate limits on some sources
    if (n > 1) await new Promise(r => setTimeout(r, 50));
  }
  return store;
}

/** Pick the window key from query/body safely. */
function pickWindowKey(value?: string | null): SamplingWindowKey {
  const v = String(value ?? "").toLowerCase();
  const keys = orderedWindowKeys(); // ["30m","1h","3h"]
  return (keys.includes(v as SamplingWindowKey) ? (v as SamplingWindowKey) : "30m");
}

// =============================================================================
// GET — stateless compute with sampling + inline CSV
// =============================================================================
export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const symbols = await resolveSymbols(url);

    const windowKey = pickWindowKey(url.searchParams.get("window") ?? "30m");
    const bins = qInt(url, "bins", 128);
    const scale = qFloat(url, "scale", 100);
    const tWin = qInt(url, "tendencyWin", 30);
    const tNorm: "mad"|"stdev" = (url.searchParams.get("tendencyNorm") ?? "mad").toLowerCase() === "stdev" ? "stdev" : "mad";
    const swapAlpha = qFloat(url, "swapAlpha", 1.2);
    const sampleCycles = qInt(url, "cycles", 0);
    const force = (url.searchParams.get("force") ?? "").toLowerCase() === "true";

    // If requested, run a few sampling cycles to populate data
    const store = await driveSampling(symbols, { window: windowKey, cycles: sampleCycles, force });

    const vectors: Record<string, ReturnType<typeof computeDetail>> = {};
    const errors: Array<{ symbol: string; error: string }> = [];

    for (const sym of symbols) {
      try {
        // Inline CSV (series_SYMBOL) has priority for quick tests
        const csv = url.searchParams.get(`series_${sym}`);
        let points: VectorPoint[] = parseSeriesCSV(csv);

        // Otherwise, use SamplingStore points for the requested window
        if (!points.length) {
          const raw: SamplingPoint[] = store.getPoints(sym, windowKey);
          points = toVectorPoints(raw);
        }

        vectors[sym] = computeDetail(points, { bins, scale, tendencyWindow: tWin, tendencyNorm: tNorm, swapAlpha });
      } catch (e: any) {
        errors.push({ symbol: sym, error: String(e?.message ?? e) });
        vectors[sym] = computeDetail([], { bins, scale, tendencyWindow: tWin, tendencyNorm: tNorm, swapAlpha });
      }
    }

    // Optional: expose light sampling diagnostics for the first window
    const diag = (() => {
      try {
        const any = symbols[0];
        if (!any) return null;
        const snap = store.snapshot(any);
        return summarizeSnapshotWindow(snap, windowKey);
      } catch { return null; }
    })();

    return NextResponse.json(
      { ok: true, ts: Date.now(), window: windowKey, bins, symbols, vectors, diag, errors },
      { headers: { "Cache-Control": "no-store, max-age=0" } }
    );
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: String(err?.message ?? err) }, { status: 500 });
  }
}

// =============================================================================
// POST — explicit points_map OR sampling when points_map is absent
// Body examples:
//
// A) Explicit points:
// {
//   "symbols": ["BTCUSDT","ETHUSDT"],
//   "bins": 128, "scale": 100, "tendencyWindow": 30, "tendencyNorm": "mad", "swapAlpha": 1.2,
//   "points_map": { "BTCUSDT":[{"price":100},{"price":101},{"price":103}], "ETHUSDT":[...] }
// }
//
// B) Drive sampling (no points_map):
// {
//   "symbols": ["BTCUSDT","ETHUSDT"], // optional; will pull from market/pairs if omitted
//   "window": "30m", "bins": 128, "scale": 100, "tendencyWindow": 30, "tendencyNorm": "mad", "swapAlpha": 1.2,
//   "cycles": 4, "force": true
// }
// =============================================================================
export async function POST(req: NextRequest) {
  try {
    const b = await req.json().catch(() => ({} as any));

    // Resolve symbols: body → market/pairs
    let symbols: string[] = Array.isArray(b?.symbols) ? b.symbols : [];
    if (!symbols.length && b?.points_map && typeof b.points_map === "object") {
      symbols = Object.keys(b.points_map);
    }
    if (!symbols.length) {
      const origin = process.env.NEXT_PUBLIC_BASE_URL ?? "http://localhost:3000";
      symbols = await getMarketSymbolsFromApi(origin);
    }
    symbols = symbols.map(s => String(s).toUpperCase()).filter(Boolean);
    if (!symbols.length) {
      return NextResponse.json({ ok: false, error: "no symbols available" }, { status: 400 });
    }

    const windowKey = pickWindowKey(b?.window ?? "30m");
    const bins: number = Number.isFinite(b?.bins) ? Math.max(1, Math.floor(b.bins)) : 128;
    const scale: number = Number.isFinite(b?.scale) ? Number(b.scale) : 100;
    const tWin: number = Number.isFinite(b?.tendencyWindow) ? Math.max(3, Math.floor(b.tendencyWindow)) : 30;
    const tNorm: "mad"|"stdev" = b?.tendencyNorm === "stdev" ? "stdev" : "mad";
    const swapAlpha: number = Number.isFinite(b?.swapAlpha) ? Number(b.swapAlpha) : 1.2;

    const vectors: Record<string, ReturnType<typeof computeDetail>> = {};
    const errors: Array<{ symbol: string; error: string }> = [];

    // Path A: explicit points_map
    if (b?.points_map && typeof b.points_map === "object") {
      for (const sym of symbols) {
        try {
          const points = Array.isArray(b.points_map[sym]) ? b.points_map[sym] : [];
          vectors[sym] = computeDetail(points, { bins, scale, tendencyWindow: tWin, tendencyNorm: tNorm, swapAlpha });
        } catch (e: any) {
          errors.push({ symbol: sym, error: String(e?.message ?? e) });
          vectors[sym] = computeDetail([], { bins, scale, tendencyWindow: tWin, tendencyNorm: tNorm, swapAlpha });
        }
      }
      return NextResponse.json(
        { ok: true, ts: Date.now(), window: windowKey, bins, symbols, vectors, errors },
        { headers: { "Cache-Control": "no-store, max-age=0" } }
      );
    }

    // Path B: sample via SamplingStore (drive a few cycles if requested)
    const cycles: number = Number.isFinite(b?.cycles) ? Math.max(0, Math.floor(b.cycles)) : 0;
    const force: boolean = Boolean(b?.force);

    const store = await driveSampling(symbols, { window: windowKey, cycles, force });
    for (const sym of symbols) {
      try {
        const raw: SamplingPoint[] = store.getPoints(sym, windowKey);
        const points: VectorPoint[] = toVectorPoints(raw);
        vectors[sym] = computeDetail(points, { bins, scale, tendencyWindow: tWin, tendencyNorm: tNorm, swapAlpha });
      } catch (e: any) {
        errors.push({ symbol: sym, error: String(e?.message ?? e) });
        vectors[sym] = computeDetail([], { bins, scale, tendencyWindow: tWin, tendencyNorm: tNorm, swapAlpha });
      }
    }

    return NextResponse.json(
      { ok: true, ts: Date.now(), window: windowKey, bins, symbols, vectors, errors },
      { headers: { "Cache-Control": "no-store, max-age=0" } }
    );
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: String(err?.message ?? err) }, { status: 500 });
  }
}
