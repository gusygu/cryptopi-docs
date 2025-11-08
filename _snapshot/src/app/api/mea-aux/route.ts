import { NextRequest, NextResponse } from "next/server";

import { db } from "@/core/db/db";
import {
  buildMeaAux,
  type BalancesMap,
  type IdPctGrid,
} from "@/core/features/mea-aux/measures";
import { DEFAULT_TIER_RULES } from "@/core/features/mea-aux/tiers";
import { resolvePairAvailability, maskUnavailableMatrix } from "@/lib/markets/availability";
import type { PairAvailabilitySnapshot } from "@/lib/markets/availability";
import { resolveCoinsFromSettings } from "@/lib/settings/server";

// NEW: mood imports (added in lib/mood.ts per our plan)
import {
  normalizeMoodInputs,
  computeMoodCoeffV1,
  moodUUIDFromBuckets,
  type MoodReferentials,
} from "@/lib/mea/mood";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const CACHE_HEADERS = { "Cache-Control": "no-store" };
const DEFAULT_COINS = ["USDT", "BTC", "ETH", "BNB", "SOL"];

type BalanceReadResult = { balances: BalancesMap; source: string };
type IdPctReadResult = { grid: IdPctGrid; source: string };

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);

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
      gfmScale: toNum(url.searchParams.get("gfmScale")) ?? 20, // +1% → 1.2
      vtMu: toNum(url.searchParams.get("vtMu")) ?? 0,
      vtSigma: toNum(url.searchParams.get("vtSigma")) ?? 0.02,
      vsMu: toNum(url.searchParams.get("vsMu")) ?? 0,
      vsSigma: toNum(url.searchParams.get("vsSigma")) ?? 0.05,
      vsAlpha: toNum(url.searchParams.get("vsAlpha")) ?? 0.75,
    };

    // If query provides raw mood inputs, use them; else fall back to neutral (or wire your metrics here)
    const haveRaw =
      q_gfmDeltaPct != null || q_tendencyRaw != null || q_swapRaw != null;

    const moodInputs = haveRaw
      ? normalizeMoodInputs(
          {
            gfmDeltaPct: q_gfmDeltaPct ?? 0,
            tendencyRaw: q_tendencyRaw ?? 0,
            swapRaw: q_swapRaw ?? 0,
          },
          refs
        )
      : // TODO: plug real server metrics -> normalizeMoodInputs(raw, refs)
        { vTendency: 0.8, GFM: 1.0, vSwap: 0 };

    const { coeff: moodCoeff, buckets } = computeMoodCoeffV1(moodInputs);
    const moodUUID = moodUUIDFromBuckets(buckets);
    // ================================================================

    // -------- build MEA weights (legacy function untouched)
    const grid = buildMeaAux({
      coins,
      idPct: idPctGrid,
      balances,
      k: divisor,
      rules: DEFAULT_TIER_RULES,
    });

    // Apply mood scaling non-destructively (keep legacy behavior intact)
    for (const base of coins) {
      for (const quote of coins) {
        if (quote === base) continue;
        const v = grid?.[base]?.[quote];
        if (v != null) grid[base][quote] = Number(v) * moodCoeff;
      }
    }

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
          // echo inputs/refs for transparency (helpful when testing via query)
          inputs: moodInputs,
          refs,
        },
        sources: {
          coins: coinsSource,
          id_pct: idPctSource,
          balances: balanceSource,
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
