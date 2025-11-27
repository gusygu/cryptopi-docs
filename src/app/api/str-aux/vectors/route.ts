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
import { requireUserSession } from "@/app/(server)/auth/session";
import {
  appendUserCycleLog,
  insertStrSamplingLog,
  type UserCycleStatus,
} from "@/lib/server/audit-log";

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
import { ensureSamplingRuntime } from "@/core/features/str-aux/sampling/runtime";
import { loadPoints, type MarketPoint } from "../utils";
import { query } from "@/core/db/pool_server";
import {
  ensureWindowPoints,
  minSamplesTarget,
} from "@/core/features/str-aux/vectors/ensureWindowPoints";

// ---- (Optional) Pairs Index resolver (uncomment & set real path if desired)
// import { resolveSymbolSelection } from "@/lib/markets/symbol-selection"; // TODO: adjust path

type VectorPayload = {
  vInner: number | null;
  vOuter: number | null;
  spread: number | null;
  vTendency: {
    score: number | null;
    direction: number | null;
    strength: number | null;
    slope: number | null;
    r: number | null;
  } | null;
  vSwap?: {
    score: number | null;
    quartile: number | null;
    q1: number | null;
    q3: number | null;
  };
};

type VectorRow = {
  symbol: string;
  window: SamplingWindowKey;
  bins: number;
  scale: number;
  samples: number;
  payload: VectorPayload;
  created_ts: string;
};

type VectorError = { symbol: string; error: string };

type VectorComputationConfig = {
  bins: number;
  scale: number;
  tendencyWindow: number;
  tendencyNorm: "mad" | "stdev";
  swapAlpha: number;
};

async function persistVector(symbol: string, window: SamplingWindowKey, summary: VectorSummary, ts: number) {
  try {
    await query(
      `INSERT INTO str_aux.window_vectors (symbol, window_label, window_start, vec, updated_at)
         VALUES ($1,$2, to_timestamp($3 / 1000.0), $4::jsonb, NOW())
         ON CONFLICT (symbol, window_label, window_start)
         DO UPDATE SET vec = EXCLUDED.vec, updated_at = NOW()`,
      [
        symbol,
        window,
        ts,
        JSON.stringify({
          inner: summary.inner,
          outer: summary.outer,
          tendency: summary.tendency,
          swap: summary.swap ?? null,
          history: summary.history ?? null,
        }),
      ],
    );
  } catch (err) {
    console.warn("[str-aux/vectors] persist failed", symbol, window, err);
  }
}

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
function neutralSummary(bins = 256, scale = 100): VectorSummary {
  return {
    scale,
    bins,
    samples: 0,
    inner: { scaled: 0, unitless: 0, weightSum: 0, perBin: [] },
    outer: { scaled: 0 },
    tendency: {
      window: 30,
      normalizer: "mad",
      series: [],
      metrics: { score: 0, direction: 0, strength: 0, slope: 0, r: 0 },
    },
    swap: { score: 0, Q: 0, q1: 0, q3: 0 },
    history: { inner: null, tendency: null },
  } as VectorSummary;
}

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

async function fallbackVectorPoints(symbol: string, window: SamplingWindowKey, bins: number): Promise<VectorPoint[]> {
  try {
    const marketPoints: MarketPoint[] = await loadPoints(symbol, window, bins);
    return marketPoints
      .map((pt) => ({
        price: Number(pt.price),
        ts: Number(pt.ts),
        volume: Number.isFinite(pt.volume) ? pt.volume : undefined,
      }))
      .filter((pt) => Number.isFinite(pt.price) && pt.price > 0);
  } catch {
    return [];
  }
}

function computeSummary(points: VectorPoint[], cfg: VectorComputationConfig): VectorSummary {
  if (!points.length) return neutralSummary(cfg.bins, cfg.scale);
  return computeVectorSummary(points, {
    bins: cfg.bins,
    scale: cfg.scale,
    history: { inner: [], tendency: [] },
    tendencyWindow: cfg.tendencyWindow,
    tendencyNorm: cfg.tendencyNorm,
    swapAlpha: cfg.swapAlpha,
  });
}

function toPayload(summary: VectorSummary): VectorPayload {
  const vInner = numOrNull(summary.inner?.scaled);
  const vOuter = numOrNull(summary.outer?.scaled);
  const spread =
    Number.isFinite(vOuter) && Number.isFinite(vInner)
      ? (vOuter as number) - (vInner as number)
      : null;
  const tm = summary.tendency?.metrics ?? {};
  const swap = summary.swap ?? null;

  return {
    vInner,
    vOuter,
    spread,
    vTendency: {
      score: numOrNull(tm.score),
      direction: numOrNull(tm.direction),
      strength: numOrNull(tm.strength),
      slope: numOrNull(tm.slope),
      r: numOrNull(tm.r),
    },
    vSwap: swap
      ? {
          score: numOrNull((swap as any).score),
          quartile: numOrNull((swap as any).Q),
          q1: numOrNull((swap as any).q1),
          q3: numOrNull((swap as any).q3),
        }
      : undefined,
  };
}

function toVectorRow(
  symbol: string,
  summary: VectorSummary,
  window: SamplingWindowKey,
  cfg: VectorComputationConfig
): VectorRow {
  return {
    symbol,
    window,
    bins: cfg.bins,
    scale: summary.scale ?? cfg.scale,
    samples: summary.samples ?? 0,
    payload: toPayload(summary),
    created_ts: new Date().toISOString(),
  };
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

type SamplingLogEntry = {
  symbol: string;
  windowLabel: SamplingWindowKey;
  status: UserCycleStatus;
  sampleTs: number | null;
  message?: string;
  meta?: Record<string, unknown>;
};

function buildSamplingLogEntry(
  store: ReturnType<typeof getSamplingStore> | null,
  symbol: string,
  windowLabel: SamplingWindowKey,
  opts: { error?: string } = {},
): SamplingLogEntry {
  if (!store) {
    return {
      symbol,
      windowLabel,
      status: opts.error ? "error" : "idle",
      sampleTs: null,
      message: opts.error,
      meta: opts.error ? { error: opts.error } : undefined,
    };
  }
  const snapshot = store.snapshot(symbol);
  const windowSummary = snapshot.windows?.[windowLabel];
  const latestMark =
    windowSummary?.marks?.[windowSummary.marks.length - 1] ??
    snapshot.lastClosedMark ??
    null;
  const status: UserCycleStatus = opts.error
    ? "error"
    : (latestMark?.health?.status ?? snapshot.cycle?.status ?? "warn");
  const sampleTs = latestMark?.closedAt ?? snapshot.lastPoint?.ts ?? null;
  const meta: Record<string, unknown> = {
    cycle: snapshot.cycle,
    window: windowSummary
      ? {
          size: windowSummary.size,
          capacity: windowSummary.capacity,
          statusCounts: windowSummary.statusCounts,
        }
      : null,
  };
  if (latestMark) {
    meta.mark = {
      id: latestMark.id,
      startedAt: latestMark.startedAt,
      closedAt: latestMark.closedAt,
      durationMs: latestMark.durationMs,
      pointsCount: latestMark.pointsCount,
      price: latestMark.price,
      spread: latestMark.spread,
      volume: latestMark.volume,
      health: latestMark.health,
    };
  }
  if (opts.error) {
    meta.error = opts.error;
  }
  return {
    symbol,
    windowLabel,
    status,
    sampleTs,
    message: opts.error,
    meta,
  };
}

async function persistCycleAudit(params: {
  ownerUserId: string;
  sessionId?: string | number | null;
  status: UserCycleStatus;
  summary: string;
  payload?: unknown;
  samplingLogs: SamplingLogEntry[];
}) {
  try {
    const cycleSeq = await appendUserCycleLog({
      ownerUserId: params.ownerUserId,
      sessionId: params.sessionId,
      status: params.status,
      summary: params.summary,
      payload: params.payload,
    });
    if (!params.samplingLogs.length) return;
    await Promise.all(
      params.samplingLogs.map((entry) =>
        insertStrSamplingLog({
          ownerUserId: params.ownerUserId,
          cycleSeq,
          symbol: entry.symbol,
          windowLabel: entry.windowLabel,
          sampleTimestamp: entry.sampleTs,
          status: entry.status,
          message: entry.message,
          meta: entry.meta ?? {},
        }),
      ),
    );
  } catch (err) {
    console.warn("[str-aux/vectors] audit logging failed:", err);
  }
}

/** Pick the window key from query/body safely. */
function pickWindowKey(value?: string | null): SamplingWindowKey {
  const v = String(value ?? "").toLowerCase();
  const keys = orderedWindowKeys(); // ["30m","1h","3h"]
  return (keys.includes(v as SamplingWindowKey) ? (v as SamplingWindowKey) : "30m");
}

// =============================================================================
// GET - stateless compute with sampling + inline CSV
// =============================================================================
export async function GET(req: NextRequest) {
  const session = await requireUserSession();
  try {
    const url = new URL(req.url);
    const symbols = await resolveSymbols(url);
    ensureSamplingRuntime();

    const windowKey = pickWindowKey(url.searchParams.get("window") ?? "30m");
    const bins = qInt(url, "bins", 256);
    const scale = qFloat(url, "scale", 100);
    const tWin = qInt(url, "tendencyWin", 30);
    const tNorm: "mad" | "stdev" =
      (url.searchParams.get("tendencyNorm") ?? "mad").toLowerCase() === "stdev"
        ? "stdev"
        : "mad";
    const swapAlpha = qFloat(url, "swapAlpha", 1.2);
    const sampleCycles = qInt(url, "cycles", 0);
    const force = (url.searchParams.get("force") ?? "").toLowerCase() === "true";
    const vectorCfg: VectorComputationConfig = {
      bins,
      scale,
      tendencyWindow: tWin,
      tendencyNorm: tNorm,
      swapAlpha,
    };

    const defaultCycles = Number.isFinite(sampleCycles) ? sampleCycles : 0;
    const store = await driveSampling(symbols, { window: windowKey, cycles: defaultCycles, force });

    const vectors: VectorRow[] = [];
    const errors: VectorError[] = [];
    const samplingLogs: SamplingLogEntry[] = [];

    for (const sym of symbols) {
      try {
        const csv = url.searchParams.get(`series_${sym}`);
        let points: VectorPoint[] = parseSeriesCSV(csv);

        if (!points.length) {
          const raw: SamplingPoint[] = await ensureWindowPoints(store, sym, windowKey, bins);
          points = toVectorPoints(raw);
        }

        const summary = computeSummary(points, vectorCfg);
        const row = toVectorRow(sym, summary, windowKey, vectorCfg);
        vectors.push(row);
        samplingLogs.push(buildSamplingLogEntry(store, sym, windowKey));
        await persistVector(sym, windowKey, summary, Date.now());
      } catch (e: any) {
        const message = String(e?.message ?? e);
        errors.push({ symbol: sym, error: message });
        samplingLogs.push(buildSamplingLogEntry(store, sym, windowKey, { error: message }));
        vectors.push(
          toVectorRow(sym, neutralSummary(vectorCfg.bins, vectorCfg.scale), windowKey, vectorCfg),
        );
      }
    }

    const diag = (() => {
      try {
        const any = symbols[0];
        if (!any) return null;
        const snap = store.snapshot(any);
        const digest = summarizeSnapshotWindow(snap, windowKey);
        return {
          window: {
            key: digest.window.key,
            size: digest.window.size,
            capacity: digest.window.capacity,
            statusCounts: digest.window.statusCounts,
          },
          cycle: digest.cycle,
          lastPoint: digest.lastPoint,
          lastClosedMark: digest.lastClosedMark
            ? {
                id: digest.lastClosedMark.id,
                startedAt: digest.lastClosedMark.startedAt,
                closedAt: digest.lastClosedMark.closedAt,
                pointsCount: digest.lastClosedMark.pointsCount,
                price: digest.lastClosedMark.price,
                spread: digest.lastClosedMark.spread,
                volume: digest.lastClosedMark.volume,
              }
            : null,
        };
      } catch {
        return null;
      }
    })();

    const cycleStatus: UserCycleStatus =
      errors.length && errors.length === symbols.length
        ? "error"
        : errors.length
        ? "warn"
        : vectors.length
        ? "ok"
        : "idle";
    const summaryParts = [`Sampled ${symbols.length} symbol(s)`];
    if (errors.length) summaryParts.push(`errors=${errors.length}`);
    const summary = summaryParts.join(" | ");

    await persistCycleAudit({
      ownerUserId: session.userId,
      status: cycleStatus,
      summary,
      payload: {
        route: "GET /api/str-aux/vectors",
        window: windowKey,
        bins,
        symbols,
        errors,
        diag,
      },
      samplingLogs,
    });

    return NextResponse.json(
      { ok: true, ts: Date.now(), window: windowKey, bins, symbols, vectors, diag, errors },
      { headers: { "Cache-Control": "no-store, max-age=0" } },
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
  const session = await requireUserSession();
  try {
    const b = await req.json().catch(() => ({} as any));
    ensureSamplingRuntime();

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
    const bins: number = Number.isFinite(b?.bins) ? Math.max(1, Math.floor(b.bins)) : 256;
    const scale: number = Number.isFinite(b?.scale) ? Number(b.scale) : 100;
    const tWin: number = Number.isFinite(b?.tendencyWindow) ? Math.max(3, Math.floor(b.tendencyWindow)) : 30;
    const tNorm: "mad"|"stdev" = b?.tendencyNorm === "stdev" ? "stdev" : "mad";
    const swapAlpha: number = Number.isFinite(b?.swapAlpha) ? Number(b.swapAlpha) : 1.2;

    const vectors: VectorRow[] = [];
    const errors: VectorError[] = [];
    const samplingLogs: SamplingLogEntry[] = [];
    const vectorCfg: VectorComputationConfig = {
      bins,
      scale,
      tendencyWindow: tWin,
      tendencyNorm: tNorm,
      swapAlpha,
    };

    // Path A: explicit points_map
    if (b?.points_map && typeof b.points_map === "object") {
      for (const sym of symbols) {
        try {
          const points = Array.isArray(b.points_map[sym]) ? b.points_map[sym] : [];
          const summary = computeSummary(points, vectorCfg);
          vectors.push(toVectorRow(sym, summary, windowKey, vectorCfg));
          samplingLogs.push(buildSamplingLogEntry(null, sym, windowKey));
        } catch (e: any) {
          const message = String(e?.message ?? e);
          errors.push({ symbol: sym, error: message });
          samplingLogs.push(buildSamplingLogEntry(null, sym, windowKey, { error: message }));
          vectors.push(
            toVectorRow(sym, neutralSummary(vectorCfg.bins, vectorCfg.scale), windowKey, vectorCfg),
          );
        }
      }
      const status: UserCycleStatus = errors.length ? "warn" : "ok";
      await persistCycleAudit({
        ownerUserId: session.userId,
        status,
        summary: `POST str-aux vectors | mode=points_map | symbols=${symbols.length}${
          errors.length ? ` | errors=${errors.length}` : ""
        }`,
        payload: {
          route: "POST /api/str-aux/vectors",
          mode: "points_map",
          window: windowKey,
          bins,
          symbols,
          errors,
        },
        samplingLogs,
      });
      return NextResponse.json(
        { ok: true, ts: Date.now(), window: windowKey, bins, symbols, vectors, errors },
        { headers: { "Cache-Control": "no-store, max-age=0" } },
      );
    }

    // Path B: sample via SamplingStore (drive a few cycles if requested)
    const cycles: number = Number.isFinite(b?.cycles) ? Math.max(0, Math.floor(b.cycles)) : 0;
    const force: boolean = Boolean(b?.force);

    const store = await driveSampling(symbols, { window: windowKey, cycles, force });
    for (const sym of symbols) {
      try {
        const raw: SamplingPoint[] = await ensureWindowPoints(store, sym, windowKey, bins);
        const points: VectorPoint[] = toVectorPoints(raw);
        const summary = computeSummary(points, vectorCfg);
        vectors.push(toVectorRow(sym, summary, windowKey, vectorCfg));
        await persistVector(sym, windowKey, summary, Date.now());
        samplingLogs.push(buildSamplingLogEntry(store, sym, windowKey));
      } catch (e: any) {
        const message = String(e?.message ?? e);
        errors.push({ symbol: sym, error: message });
        samplingLogs.push(buildSamplingLogEntry(store, sym, windowKey, { error: message }));
        vectors.push(
          toVectorRow(sym, neutralSummary(vectorCfg.bins, vectorCfg.scale), windowKey, vectorCfg),
        );
      }
    }

    const cycleStatus: UserCycleStatus =
      errors.length && errors.length === symbols.length
        ? "error"
        : errors.length
        ? "warn"
        : vectors.length
        ? "ok"
        : "idle";
    await persistCycleAudit({
      ownerUserId: session.userId,
      status: cycleStatus,
      summary: `POST str-aux vectors | mode=sampling | symbols=${symbols.length}${
        errors.length ? ` | errors=${errors.length}` : ""
      }`,
      payload: {
        route: "POST /api/str-aux/vectors",
        mode: "sampling",
        window: windowKey,
        bins,
        symbols,
        errors,
      },
      samplingLogs,
    });

    return NextResponse.json(
      { ok: true, ts: Date.now(), window: windowKey, bins, symbols, vectors, errors },
      { headers: { "Cache-Control": "no-store, max-age=0" } },
    );
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: String(err?.message ?? err) }, { status: 500 });
  }
}
