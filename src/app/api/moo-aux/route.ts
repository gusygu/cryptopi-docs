import { NextRequest, NextResponse } from "next/server";

import { db } from "@/core/db/db";
import {
  buildMeaAux,
  type BalancesMap,
  type IdPctGrid,
  saveMoodObservation,
} from "@/core/features/moo-aux/measures";
import { DEFAULT_TIER_RULES } from "@/core/features/moo-aux/tiers";
import { resolvePairAvailability, maskUnavailableMatrix } from "@/lib/markets/availability";
import type { PairAvailabilitySnapshot } from "@/lib/markets/availability";
import { resolveCoinsFromSettings } from "@/lib/settings/server";
import { computeSampledMetrics } from "@/core/features/str-aux/calc/panel";
import type { StatsOptions } from "@/core/features/str-aux/calc/stats";
import type { SamplingWindowKey } from "@/core/features/str-aux/sampling";

// NEW: mood imports (added in lib/mood.ts per our plan)
import {
  normalizeMoodInputs,
  computeMoodCoeffV1,
  moodUUIDFromBuckets,
  type MoodInputs,
  type MoodReferentials,
} from "@/lib/mea/mood";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const CACHE_HEADERS = { "Cache-Control": "no-store" };
const DEFAULT_COINS = ["USDT", "BTC", "ETH", "BNB", "SOL"];
const DEFAULT_APP_SESSION = process.env.NEXT_PUBLIC_APP_SESSION_ID ?? "moo-aux";
const STR_MOOD_WINDOW: SamplingWindowKey =
  (process.env.MOO_AUX_STR_WINDOW as SamplingWindowKey) ?? "30m";
const STR_MOOD_BINS = Number.isFinite(Number(process.env.MOO_AUX_STR_BINS))
  ? Math.max(16, Math.floor(Number(process.env.MOO_AUX_STR_BINS)))
  : 128;
const MAX_MOOD_SYMBOLS = Number.isFinite(Number(process.env.MOO_AUX_SYMBOL_LIMIT))
  ? Math.max(1, Math.floor(Number(process.env.MOO_AUX_SYMBOL_LIMIT)))
  : 12;
const DEFAULT_MOOD_STATS: StatsOptions = {
  idhr: { alpha: 2.5, sMin: 1e-6, smooth: 3, topK: 8 },
  epsGfmPct: 0.35,
  epsBfmPct: 0.35,
  vScale: 100,
  tendencyWin: 30,
  tendencyNorm: "mad",
  swapAlpha: 1.2,
};

type BalanceReadResult = { balances: BalancesMap; source: string };
type IdPctReadResult = { grid: IdPctGrid; source: string };
type MoodSignalValues = { gfmDeltaPct: number; tendencyRaw: number; swapRaw: number };
type SymbolMoodSignals = MoodSignalValues & {
  symbol: string;
  base: string;
  quote: string;
  weight: number;
};
type MoodRawDescriptor = {
  source: string;
  signals: MoodSignalValues;
  symbols: string[];
  perSymbol: SymbolMoodSignals[];
};

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const appSessionId = (url.searchParams.get("sessionId") ?? DEFAULT_APP_SESSION).slice(0, 64);

    // -------- timing
    const tsParam = Number(url.searchParams.get("ts") ?? url.searchParams.get("timestamp"));
    const tsMs = Number.isFinite(tsParam) && tsParam > 0 ? tsParam : Date.now();

    // -------- coins universe
    const { coins: initialCoins, source: coinsSource } = await resolveCoins(url);

    // -------- id_pct grid (DB-backed)
    const { grid: idPctGridRaw, source: idPctSource } = await readIdPctGrid(initialCoins, tsMs);
    const dedupedCoins = dedupeCoins([...initialCoins, ...coinsFromGrid(idPctGridRaw)]);
    if (!dedupedCoins.length) {
      return NextResponse.json(
        { ok: true, coins: [], k: 0, grid: {} },
        { headers: CACHE_HEADERS },
      );
    }
    let coins = dedupedCoins;
    if (!coins.includes("USDT")) coins = ["USDT", ...coins];

    // -------- availability filter
    const availability: PairAvailabilitySnapshot = await resolvePairAvailability(coins);
    const allowedSymbols = availability.set;
    const moodSymbols = deriveMoodSymbols(coins, allowedSymbols);

    // -------- normalize id_pct grid + balances
    const idPctGrid = ensureIdPctGrid(idPctGridRaw, coins);
    const { balances, source: balanceSource } = await readBalancesFromLedger(coins);

    // -------- divisor (k)
    const kParam = Number(url.searchParams.get("k"));
    const divisor = Number.isFinite(kParam) && kParam > 0
      ? Math.floor(kParam)
      : Math.max(1, coins.length - 1);

    // ======== NEW: mood normalization & coefficient (anchored) ========
    // Query overrides (optional) for testing:
    const q_gfmDeltaPct = toNum(url.searchParams.get("gfmDeltaPct")); // e.g. 0.01 for +1%
    const q_tendencyRaw = toNum(url.searchParams.get("tendencyRaw"));
    const q_swapRaw     = toNum(url.searchParams.get("swapRaw"));

    const refs: MoodReferentials = {
      gfmScale: toNum(url.searchParams.get("gfmScale")) ?? 20,
      vtMu: toNum(url.searchParams.get("vtMu")) ?? 0,
      vtSigma: toNum(url.searchParams.get("vtSigma")) ?? 0.02,
      vsMu: toNum(url.searchParams.get("vsMu")) ?? 0,
      vsSigma: toNum(url.searchParams.get("vsSigma")) ?? 0.05,
      vsAlpha: toNum(url.searchParams.get("vsAlpha")) ?? 0.75,
    };

    const haveRaw =
      q_gfmDeltaPct != null || q_tendencyRaw != null || q_swapRaw != null;

    const manualSignals: MoodSignalValues = {
      gfmDeltaPct: q_gfmDeltaPct ?? 0,
      tendencyRaw: q_tendencyRaw ?? 0,
      swapRaw: q_swapRaw ?? 0,
    };

    let derivedSignals = haveRaw
      ? null
      : await computeMoodSignalsFromStrAux(moodSymbols, STR_MOOD_WINDOW).catch(() => null);
    if (!derivedSignals) {
      derivedSignals = { gfmDeltaPct: 0, tendencyRaw: 0, swapRaw: 0, symbols: [] };
    }

    const moodRawDescriptor: MoodRawDescriptor = haveRaw
      ? { source: "query", signals: manualSignals, symbols: [], perSymbol: [] }
      : {
          source: derivedSignals.symbols.length ? "str-aux" : "str-aux:fallback",
          signals: {
            gfmDeltaPct: derivedSignals.gfmDeltaPct,
            tendencyRaw: derivedSignals.tendencyRaw,
            swapRaw: derivedSignals.swapRaw,
          },
          symbols: derivedSignals.symbols,
          perSymbol: derivedSignals.perSymbol,
        };

    const moodInputs = normalizeMoodInputs(
      {
        gfmDeltaPct: moodRawDescriptor.signals.gfmDeltaPct,
        tendencyRaw: moodRawDescriptor.signals.tendencyRaw,
        swapRaw: moodRawDescriptor.signals.swapRaw,
      },
      refs
    );

    const { coeff: moodCoeff, buckets } = computeMoodCoeffV1(moodInputs);
    const moodUUID = moodUUIDFromBuckets(buckets);
    const perSymbolMood = buildPerSymbolMood(moodRawDescriptor.perSymbol, refs);
    // ================================================================

    // -------- build MEA weights (legacy function untouched)
    const grid = buildMeaAux({
      coins,
      idPct: idPctGrid,
      balances,
      k: divisor,
      rules: DEFAULT_TIER_RULES,
      moodCoeff,
    });

    // Persist observation (best-effort)
    const observationPayload = {
      source: moodRawDescriptor.source,
      symbols: moodRawDescriptor.symbols,
      signals: moodRawDescriptor.signals,
      inputs: moodInputs,
      refs,
      perSymbol: perSymbolMood,
    };
    saveMoodObservation(appSessionId, tsMs, moodUUID, moodCoeff, observationPayload).catch((err) => {
      console.warn("[moo-aux] mood observation skipped:", err);
    });

    // -------- mask unavailable symbols/pairs
    if (allowedSymbols.size) {
      maskUnavailableMatrix(grid, allowedSymbols);
      maskUnavailableMatrix(idPctGrid, allowedSymbols);
    }

    // -------- response
    return NextResponse.json(
      {
        ok: true,
        ts_ms: tsMs,
        coins,
        k: divisor,
        grid,
        id_pct: idPctGrid,
        balances,
        mood: {
          coeff: moodCoeff,
          uuid: moodUUID,
          inputs: moodInputs,
          refs,
          raw: moodRawDescriptor,
          perSymbol: perSymbolMood,
        },
        sources: {
          coins: coinsSource,
          id_pct: idPctSource,
          balances: balanceSource,
          mood: moodRawDescriptor.source,
        },
        availability: {
          symbols: availability.symbols,
          pairs: availability.pairs,
        },
      },
      { headers: CACHE_HEADERS },
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { ok: false, error: message },
      { status: 500, headers: CACHE_HEADERS },
    );
  }
}

// ───────────────── helpers (unchanged + small additions)

function toNum(x: string | null): number | null {
  if (x == null) return null;
  const n = Number(x);
  return Number.isFinite(n) ? n : null;
}

function normalizeCoinSymbol(raw: string | null | undefined): string | null {
  if (raw == null) return null;
  const trimmed = String(raw).trim().toUpperCase();
  return trimmed ? trimmed : null;
}

function splitSymbolPair(symbol: string): { base: string; quote: string } | null {
  const upper = String(symbol ?? "").trim().toUpperCase();
  if (!upper) return null;
  const commons = ["USDT", "USD", "USDC", "BUSD", "EUR", "BTC", "ETH", "BNB", "BRL"];
  for (const quote of commons) {
    if (upper.endsWith(quote) && upper.length > quote.length) {
      return { base: upper.slice(0, -quote.length), quote };
    }
  }
  if (upper.length >= 6) {
    return { base: upper.slice(0, upper.length - 4), quote: upper.slice(-4) };
  }
  return null;
}

type MoodSignals = {
  gfmDeltaPct: number;
  tendencyRaw: number;
  swapRaw: number;
  symbols: string[];
  perSymbol: SymbolMoodSignals[];
};

function deriveMoodSymbols(coins: string[], allowed: Set<string>): string[] {
  const normalized = Array.from(
    new Set(coins.map((coin) => normalizeCoinSymbol(coin)).filter((c): c is string => Boolean(c)))
  );
  const desired: string[] = [];
  for (const base of normalized) {
    const preferred = `${base}USDT`;
    if (base !== "USDT" && allowed.has(preferred)) desired.push(preferred);
  }
  for (const base of normalized) {
    for (const quote of normalized) {
      if (base === quote) continue;
      const symbol = `${base}${quote}`;
      if (allowed.has(symbol)) desired.push(symbol);
    }
  }
  if (!desired.length && allowed.size) {
    for (const symbol of allowed) desired.push(String(symbol ?? "").toUpperCase());
  }
  const unique = Array.from(new Set(desired.map((s) => String(s ?? "").toUpperCase()).filter(Boolean)));
  return unique.slice(0, MAX_MOOD_SYMBOLS);
}

function buildPerSymbolMood(details: SymbolMoodSignals[], refs: MoodReferentials) {
  const out: Record<string, Record<string, {
    coeff: number;
    uuid: string;
    inputs: MoodInputs;
    raw: SymbolMoodSignals;
  }>> = {};
  for (const detail of details ?? []) {
    const normalized = normalizeMoodInputs(
      {
        gfmDeltaPct: detail.gfmDeltaPct,
        tendencyRaw: detail.tendencyRaw,
        swapRaw: detail.swapRaw,
      },
      refs
    );
    const { coeff, buckets } = computeMoodCoeffV1(normalized);
    const uuid = moodUUIDFromBuckets(buckets);
    const quote = detail.quote;
    const base = detail.base;
    if (!quote || !base) continue;
    (out[quote] ??= {})[base] = {
      coeff,
      uuid,
      inputs: normalized,
      raw: detail,
    };
  }
  return out;
}

async function computeMoodSignalsFromStrAux(
  symbols: string[],
  window: SamplingWindowKey
): Promise<MoodSignals> {
  const unique = Array.from(new Set(symbols.map((s) => String(s ?? "").toUpperCase()).filter(Boolean)));
  if (!unique.length) {
    return { gfmDeltaPct: 0, tendencyRaw: 0, swapRaw: 0, symbols: [], perSymbol: [] };
  }
  const limited = unique.slice(0, MAX_MOOD_SYMBOLS);
  const results = await computeSampledMetrics(limited, {
    window,
    bins: STR_MOOD_BINS,
    stats: DEFAULT_MOOD_STATS,
  });
  const fallbackTargets: string[] = [];
  for (const symbol of limited) {
    const entry = results[symbol];
    if (!entry || !entry.ok) {
      fallbackTargets.push(symbol);
      continue;
    }
    const tendencyScore = Number(entry.stats.vectors?.tendency?.metrics?.score);
    const swapScore = Number(entry.stats.vectors?.swap?.score);
    if (!Number.isFinite(tendencyScore) || !Number.isFinite(swapScore)) {
      fallbackTargets.push(symbol);
    }
  }
  const fallbackMap = fallbackTargets.length
    ? await fetchWindowVectorFallbacks(fallbackTargets, window)
    : {};
  let gfmNum = 0;
  let gfmDen = 0;
  let tendNum = 0;
  let tendDen = 0;
  let swapNum = 0;
  let swapDen = 0;
  const used: string[] = [];
  const perSymbol: SymbolMoodSignals[] = [];
  for (const symbol of limited) {
    const entry = results[symbol];
    const fallback = fallbackMap[symbol];
    if ((!entry || !entry.ok) && !fallback) continue;
    const weight = entry && entry.ok
      ? Math.max(1, Number(entry.meta?.n ?? 0) || 1)
      : Math.max(1, Number(fallback?.weight ?? 1));
    let usedSymbol = false;
    const gfmPct = entry && entry.ok ? Number(entry.stats.deltaGfmPct) : NaN;
    if (Number.isFinite(gfmPct)) {
      gfmNum += (gfmPct / 100) * weight;
      gfmDen += weight;
      usedSymbol = true;
    }
    let tendencyScore = entry && entry.ok
      ? Number(entry.stats.vectors?.tendency?.metrics?.score)
      : NaN;
    if (!Number.isFinite(tendencyScore) && fallback) {
      const fbTendency = Number(fallback.tendency);
      if (Number.isFinite(fbTendency)) tendencyScore = fbTendency;
    }
    if (Number.isFinite(tendencyScore)) {
      tendNum += (tendencyScore / 100) * weight;
      tendDen += weight;
      usedSymbol = true;
    }
    let swapScore = entry && entry.ok
      ? Number(entry.stats.vectors?.swap?.score)
      : NaN;
    if (!Number.isFinite(swapScore) && fallback) {
      const fbSwap = Number(fallback.swap);
      if (Number.isFinite(fbSwap)) swapScore = fbSwap;
    }
    if (Number.isFinite(swapScore)) {
      swapNum += (swapScore / 100) * weight;
      swapDen += weight;
      usedSymbol = true;
    }
    const pair = splitSymbolPair(symbol);
    if (pair && (Number.isFinite(gfmPct) || Number.isFinite(tendencyScore) || Number.isFinite(swapScore))) {
      perSymbol.push({
        symbol,
        base: pair.base,
        quote: pair.quote,
        weight,
        gfmDeltaPct: Number.isFinite(gfmPct) ? gfmPct / 100 : 0,
        tendencyRaw: Number.isFinite(tendencyScore) ? tendencyScore / 100 : 0,
        swapRaw: Number.isFinite(swapScore) ? swapScore / 100 : 0,
      });
    }
    if (usedSymbol) used.push(symbol);
  }
  return {
    gfmDeltaPct: gfmDen ? gfmNum / gfmDen : 0,
    tendencyRaw: tendDen ? tendNum / tendDen : 0,
    swapRaw: swapDen ? swapNum / swapDen : 0,
    symbols: used,
    perSymbol,
  };
}

function dedupeCoins(list: Array<string>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of list) {
    const norm = normalizeCoinSymbol(item);
    if (!norm || seen.has(norm)) continue;
    seen.add(norm);
    out.push(norm);
  }
  return out;
}

function emptyBalances(coins: string[]): BalancesMap {
  const out: BalancesMap = {};
  for (const coin of coins) out[coin] = 0;
  return out;
}

function coinsFromGrid(grid: IdPctGrid): string[] {
  const set = new Set<string>();
  for (const base of Object.keys(grid ?? {})) {
    if (base) set.add(base);
    const row = grid?.[base] ?? {};
    for (const quote of Object.keys(row)) {
      if (quote) set.add(quote);
    }
  }
  return Array.from(set);
}

function ensureIdPctGrid(grid: IdPctGrid, coins: string[]): IdPctGrid {
  for (const base of coins) {
    if (!grid[base]) grid[base] = {};
    for (const quote of coins) {
      if (base === quote) {
        grid[base][quote] = null;
        continue;
      }
      const raw = Number(grid[base][quote]);
      grid[base][quote] = Number.isFinite(raw) ? raw : 0;
    }
  }
  return grid;
}

async function resolveCoins(url: URL): Promise<{ coins: string[]; source: string }> {
  const coinsParam = url.searchParams.get("coins");
  if (coinsParam) {
    const tokens = coinsParam
      .split(/[,\s]+/)
      .map((token) => token.trim().toUpperCase())
      .filter(Boolean);
    const coins = dedupeCoins(tokens);
    if (coins.length) return { coins, source: "query" };
  }

  try {
    const settingsCoins = await resolveCoinsFromSettings();
    const coins = dedupeCoins(settingsCoins);
    if (coins.length) return { coins, source: "settings" };
  } catch {
    // ignore parse errors from cookies/session
  }

  return { coins: [...DEFAULT_COINS], source: "fallback" };
}

async function readBalancesFromLedger(coins: string[]): Promise<BalanceReadResult> {
  if (!coins.length) return { balances: {}, source: "empty" };

  const targets = coins.map((coin) => coin.toUpperCase());
  const zeros = emptyBalances(targets);

  try {
    const { rows } = await db.query<{ asset: string; amount: string | number }>(
      `SELECT asset, amount
         FROM wallet_balances_latest
        WHERE asset = ANY($1::text[])`,
      [targets],
    );
    if (rows?.length) {
      const balances = { ...zeros };
      for (const row of rows) {
        const asset = normalizeCoinSymbol(row.asset);
        if (!asset) continue;
        const amount = Number(row.amount);
        balances[asset] = Number.isFinite(amount) ? amount : 0;
      }
      return { balances, source: "wallet_balances_latest" };
    }
  } catch {
    // preferred view may not exist; fall through
  }

  try {
    const { rows } = await db.query<{ asset: string; amount: string | number }>(
      `SELECT DISTINCT ON (asset) asset, amount
         FROM balances
        WHERE asset = ANY($1::text[])
        ORDER BY asset, ts_epoch_ms DESC`,
      [targets],
    );
    if (rows?.length) {
      const balances = { ...zeros };
      for (const row of rows) {
        const asset = normalizeCoinSymbol(row.asset);
        if (!asset) continue;
        const amount = Number(row.amount);
        balances[asset] = Number.isFinite(amount) ? amount : 0;
      }
      return { balances, source: "balances" };
    }
  } catch {
    // optional historical table; fall through
  }

  return { balances: zeros, source: "fallback:zero" };
}

async function readIdPctGrid(coins: string[], tsMs: number): Promise<IdPctReadResult> {
  const targets = coins.map((coin) => coin.toUpperCase());
  const baseGrid: IdPctGrid = {};
  for (const base of targets) {
    baseGrid[base] = {};
    for (const quote of targets) baseGrid[base][quote] = base === quote ? null : 0;
  }

  if (!targets.length) return { grid: baseGrid, source: "empty" };

  const applyIdPctRows = (rows: Array<{ base: string; quote: string; value: number }>, source: string) => {
    if (!rows?.length) return null;
    for (const row of rows) {
      const base = normalizeCoinSymbol(row.base);
      const quote = normalizeCoinSymbol(row.quote);
      if (!base || !quote || base === quote) continue;
      if (!baseGrid[base]) baseGrid[base] = {};
      const idp = Number(row.value);
      baseGrid[base][quote] = Number.isFinite(idp) ? idp : 0;
    }
    return { grid: ensureIdPctGrid(baseGrid, targets), source };
  };

  if (Number.isFinite(tsMs)) {
    try {
      const { rows } = await db.query<{ base: string; quote: string; value: number }>(
        `SELECT DISTINCT ON (base, quote) base, quote, value
           FROM matrices.dyn_values
          WHERE matrix_type = 'id_pct'
            AND ts_ms <= $1
            AND base = ANY($2::text[])
            AND quote = ANY($2::text[])
          ORDER BY base, quote, ts_ms DESC`,
        [tsMs, targets],
      );
      const applied = applyIdPctRows(rows, "matrices.dyn_values");
      if (applied) return applied;
    } catch {
      // fall back to other sources
    }
  }

  try {
    const { rows } = await db.query<{ base: string; quote: string; value: number }>(
      `SELECT DISTINCT ON (base, quote) base, quote, value
         FROM matrices.dyn_values
        WHERE matrix_type = 'id_pct'
          AND base = ANY($1::text[])
          AND quote = ANY($1::text[])
        ORDER BY base, quote, ts_ms DESC`,
      [targets],
    );
    const applied = applyIdPctRows(rows, "matrices.dyn_values");
    if (applied) return applied;
  } catch {
    // continue with legacy fallbacks
  }

  if (Number.isFinite(tsMs)) {
    try {
      const { rows } = await db.query<{ base: string; quote: string; id_pct: number }>(
        `SELECT DISTINCT ON (base, quote) base, quote, id_pct
           FROM id_pct_pairs
          WHERE ts_epoch_ms <= $1
            AND base = ANY($2::text[])
            AND quote = ANY($2::text[])
          ORDER BY base, quote, ts_epoch_ms DESC`,
        [tsMs, targets],
      );
      if (rows?.length) {
        for (const row of rows) {
          const base = normalizeCoinSymbol(row.base);
          const quote = normalizeCoinSymbol(row.quote);
          if (!base || !quote || base === quote) continue;
          const idp = Number(row.id_pct);
          if (!baseGrid[base]) baseGrid[base] = {};
          baseGrid[base][quote] = Number.isFinite(idp) ? idp : 0;
        }
        return { grid: ensureIdPctGrid(baseGrid, targets), source: "id_pct_pairs" };
      }
    } catch {
      // fall back to latest view
    }
  }

  try {
    const { rows } = await db.query<{ base: string; quote: string; id_pct: number }>(
      `SELECT base, quote, id_pct
         FROM id_pct_latest
        WHERE base = ANY($1::text[])
          AND quote = ANY($1::text[])`,
      [targets],
    );
    if (rows?.length) {
      for (const row of rows) {
        const base = normalizeCoinSymbol(row.base);
        const quote = normalizeCoinSymbol(row.quote);
        if (!base || !quote || base === quote) continue;
        const idp = Number(row.id_pct);
        if (!baseGrid[base]) baseGrid[base] = {};
        baseGrid[base][quote] = Number.isFinite(idp) ? idp : 0;
      }
      return { grid: ensureIdPctGrid(baseGrid, targets), source: "id_pct_latest" };
    }
  } catch {
    // fall through to metrics table
  }

  const metricKeys: string[] = [];
  for (const base of targets) {
    for (const quote of targets) {
      if (base === quote) continue;
      metricKeys.push(`id_pct:${base}|${quote}`);
    }
  }

  if (metricKeys.length) {
    try {
      const { rows } = await db.query<{ metric_key: string; value: number }>(
        `SELECT DISTINCT ON (metric_key) metric_key, value
           FROM metrics
          WHERE metric_key = ANY($1::text[])
          ORDER BY metric_key, ts_epoch_ms DESC`,
        [metricKeys],
      );
      if (rows?.length) {
        for (const row of rows) {
          const key = String(row.metric_key ?? "");
          const [, payload] = key.split("id_pct:");
          if (!payload) continue;
          const [baseRaw, quoteRaw] = payload.split("|");
          const base = normalizeCoinSymbol(baseRaw);
          const quote = normalizeCoinSymbol(quoteRaw);
          if (!base || !quote || base === quote) continue;
          if (!baseGrid[base]) baseGrid[base] = {};
          const idp = Number(row.value);
          baseGrid[base][quote] = Number.isFinite(idp) ? idp : 0;
        }
        return { grid: ensureIdPctGrid(baseGrid, targets), source: "metrics" };
      }
    } catch {
      // ignore and fall back to zeros
    }
  }

  return { grid: ensureIdPctGrid(baseGrid, targets), source: "fallback:zero" };
}

type VectorFallbackStats = {
  symbol: string;
  tendency: number | null;
  swap: number | null;
  weight: number;
};

async function fetchWindowVectorFallbacks(
  symbols: string[],
  window: SamplingWindowKey
): Promise<Record<string, VectorFallbackStats>> {
  const targets = Array.from(
    new Set(
      symbols
        .map((sym) => normalizeCoinSymbol(sym))
        .filter((sym): sym is string => Boolean(sym))
    )
  );
  if (!targets.length) return {};

  type Row = {
    symbol: string;
    v_tend_close: number | null;
    v_swap_close: number | null;
    cycles_count: number | null;
  };

  try {
    const { rows } = await db.query<Row>(
      `select symbol, v_tend_close, v_swap_close, cycles_count
         from str_aux.v_latest_windows
        where window_label = $1
          and symbol = any($2::text[])`,
      [window, targets]
    );
    const out: Record<string, VectorFallbackStats> = {};
    for (const row of rows ?? []) {
      const symbol = normalizeCoinSymbol(row.symbol);
      if (!symbol) continue;
      out[symbol] = {
        symbol,
        tendency: toNum(row.v_tend_close),
        swap: toNum(row.v_swap_close),
        weight: Math.max(1, Number(row.cycles_count) || 1),
      };
    }
    return out;
  } catch {
    return {};
  }
}
