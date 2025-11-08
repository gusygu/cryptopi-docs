// app/api/matrices/latest/route.ts

import { NextResponse } from "next/server";
import { cookies, headers } from "next/headers";
import type { NextApiRequest, NextApiResponse } from "next";
import {
  getPrevSnapshotByType,
  getPrevValue,
} from "@/core/db/db";
import { liveFromSources } from "@/core/features/matrices/liveFromSources";
import {
  configureBenchmarkProviders,
  computeFromDbAndLive,
} from "@/core/maths/math";
import { fetchOpeningGridFromView } from "@/core/features/matrices/opening";
import { resolveCoinsFromSettings } from "@/lib/settings/server";
// typed downstream import from matrices frozen helpers (no runtime impact)
import type {
  FrozenPairKey,
  buildFrozenSetFromFlags,
  materializeFrozenGridFromSet,
  isPairFrozenFromSet,
  getFrozenSetFromMatricesLatest,
} from "@/core/features/matrices/matrices";
import { query } from "@/core/db/pool_server";

// keep these aliases so TS treats the imports as “used” (still type-only)
type _FrozenPairKey = FrozenPairKey;
type _FrozenSetBuilder = typeof buildFrozenSetFromFlags;
type _FrozenGridMaterializer = typeof materializeFrozenGridFromSet;
type _IsPairFrozen = typeof isPairFrozenFromSet;
type _GetFrozenSetLatest = typeof getFrozenSetFromMatricesLatest;

const ALLOWED_WINDOWS = new Set(["15m", "30m", "1h"] as const);
type MatrixWindow = "15m" | "30m" | "1h";

const normalizeCoins = (xs: readonly string[]) =>
  Array.from(new Set(xs.map((s) => s.trim().toUpperCase()).filter(Boolean)));

function parseCoinsCSV(csv: string | null | undefined): string[] | null {
  if (!csv) return null;
  return normalizeCoins(csv.split(","));
}

function parseCoinsJSON(jsonStr: string | null | undefined): string[] | null {
  if (!jsonStr) return null;
  try {
    const xs = JSON.parse(jsonStr);
    if (!Array.isArray(xs)) return null;
    return normalizeCoins(xs);
  } catch {
    return null;
  }
}

function coinsAddUSDTFirst(userCoins: readonly string[]) {
  const xs = normalizeCoins(userCoins);
  const withoutUSDT = xs.filter((c) => c !== "USDT");
  return ["USDT", ...withoutUSDT];
}

async function coinsFromCookiesOrHeaders(): Promise<string[] | null> {
  const bagCookies = cookies();
  const bagHeaders = headers();

  const ckJson = (await bagCookies).get("cp_coins")?.value; // JSON array
  const ckCsv = (await bagCookies).get("cp.coins")?.value; // CSV
  const fromCkJson = parseCoinsJSON(ckJson);
  const fromCkCsv = parseCoinsCSV(ckCsv);
  if (fromCkJson?.length) return fromCkJson;
  if (fromCkCsv?.length) return fromCkCsv;

  const hxCsv = (await bagHeaders).get("x-cp-coins");
  const hxJson = (await bagHeaders).get("x-cp-coins-json");
  const fromHxCsv = parseCoinsCSV(hxCsv ?? undefined);
  const fromHxJson = parseCoinsJSON(hxJson ?? undefined);
  if (fromHxJson?.length) return fromHxJson;
  if (fromHxCsv?.length) return fromHxCsv;

  return null;
}

async function resolveCoinsUniverse(preferred: string[] | null): Promise<string[]> {
  if (preferred && preferred.length) return coinsAddUSDTFirst(preferred);

  const legacy = await coinsFromCookiesOrHeaders();
  if (legacy?.length) return coinsAddUSDTFirst(legacy);

  const fromSettings = await resolveCoinsFromSettings();
  if (fromSettings.length) return coinsAddUSDTFirst(fromSettings);

  return ["USDT"];
}

function ensureWindow(win: string | null | undefined): MatrixWindow {
  if (!win) return "30m";
  const lc = win.toLowerCase();
  return ALLOWED_WINDOWS.has(lc as MatrixWindow)
    ? (lc as MatrixWindow)
    : "30m";
}

type MatValues = Record<string, Record<string, number | null>>;

type MatricesLatestSuccessPayload = {
  ok: true;
  coins: string[];
  symbols: string[];
  quote: string;
  window: MatrixWindow;
  ts: number;
  matrices: {
    benchmark: { ts: number; values: MatValues; flags?: any };
    pct24h: { ts: number; values: MatValues; flags?: any };
    id_pct: { ts: number; values: MatValues };
    pct_drv: { ts: number; values: MatValues };
    pct_ref: { ts: number; values: MatValues };
    ref: { ts: number; values: MatValues };
    delta: { ts: number; values: MatValues };
  };
  meta: {
    openingTs: number | null;
    universe: string[];
  };
};

type MatricesLatestErrorPayload = {
  ok: false;
  error: string;
};

export type MatricesLatestPayload =
  | MatricesLatestSuccessPayload
  | MatricesLatestErrorPayload;

function toGrid(
  coins: readonly string[],
  values: MatValues
): (number | null)[][] {
  const n = coins.length;
  const grid: (number | null)[][] = Array.from({ length: n }, () =>
    Array.from({ length: n }, () => null)
  );
  for (let i = 0; i < n; i++) {
    const bi = coins[i]!;
    const row = values[bi] || {};
    for (let j = 0; j < n; j++) {
      if (i === j) continue;
      const qj = coins[j]!;
      const v = row[qj];
      grid[i][j] = v == null ? null : Number(v);
    }
  }
  return grid;
}

function toValues(
  coins: readonly string[],
  grid: (number | null)[][]
): MatValues {
  const out: MatValues = {};
  for (let i = 0; i < coins.length; i++) {
    const bi = coins[i]!;
    out[bi] = {} as any;
    for (let j = 0; j < coins.length; j++) {
      if (i === j) continue;
      const qj = coins[j]!;
      out[bi][qj] = grid[i][j] ?? null;
    }
  }
  return out;
}

function parseQuery(req: Request): {
  coins: string[] | null;
  quote: string;
  window: MatrixWindow;
  appSessionId: string | null;
} {
  const url = new URL(req.url);
  const qCoins = parseCoinsCSV(url.searchParams.get("coins"));
  const quote = (url.searchParams.get("quote") || "USDT").toUpperCase();
  const window = ensureWindow(url.searchParams.get("window"));
  const appSessionId = url.searchParams.get("appSessionId") || null;
  return { coins: qCoins, quote, window, appSessionId };
}

type BuildMatricesLatestArgs = {
  coins?: string[] | null;
  quote?: string;
  window?: string | null;
  appSessionId?: string | null;
};

const pickValues = (coins: readonly string[], vals: MatValues): MatValues => {
  const toKeep = coins;
  const out: MatValues = {};
  for (const b of toKeep) {
    const row = vals[b] || {};
    const dst: Record<string, number | null> = {};
    for (const q of toKeep) {
      if (b === q) continue;
      if (Object.prototype.hasOwnProperty.call(row, q)) {
        dst[q] = row[q]!;
      }
    }
    out[b] = dst;
  }
  return out;
};

export async function buildMatricesLatestPayload(
  params: BuildMatricesLatestArgs = {}
): Promise<MatricesLatestPayload> {
  const quote = (params.quote ?? "USDT").toUpperCase();
  const window = ensureWindow(params.window ?? null);
  const appSessionId = params.appSessionId ?? null;

  try {
    const queryCoinsNormalized = Array.isArray(params.coins)
      ? normalizeCoins(params.coins)
      : null;

    const coins = await resolveCoinsUniverse(
      queryCoinsNormalized && queryCoinsNormalized.length
        ? queryCoinsNormalized
        : null
    );

    if (!coins.length) {
      throw new Error("No coins resolved for matrices universe");
    }

    const live = await liveFromSources(coins);

    const bmGrid = toGrid(coins, live.matrices.benchmark.values);
    const nowTs = live.matrices.benchmark.ts;

    const [prevBenchmarkRows, prevIdPctRows] = await Promise.all([
      getPrevSnapshotByType("benchmark", nowTs, coins),
      getPrevSnapshotByType("id_pct", nowTs, coins),
    ]);

    const prevBenchmarkMap = new Map<string, number>();
    for (const row of prevBenchmarkRows) {
      const key = `${row.base.toUpperCase()}/${row.quote.toUpperCase()}`;
      const value = Number(row.value);
      if (Number.isFinite(value)) prevBenchmarkMap.set(key, value);
    }

    const prevIdPctMap = new Map<string, number>();
    for (const row of prevIdPctRows) {
      const key = `${row.base.toUpperCase()}/${row.quote.toUpperCase()}`;
      const value = Number(row.value);
      if (Number.isFinite(value)) prevIdPctMap.set(key, value);
    }

    let lastOpeningTs: number | null = null;

    configureBenchmarkProviders({
      getPrev: async (matrix_type, base, quoteSym, beforeTs) => {
        const key = `${base.toUpperCase()}/${quoteSym.toUpperCase()}`;
        const fromPrefetch =
          matrix_type === "benchmark"
            ? prevBenchmarkMap.get(key)
            : matrix_type === "id_pct"
            ? prevIdPctMap.get(key)
            : undefined;
        if (fromPrefetch != null) return fromPrefetch;
        return getPrevValue(
          matrix_type,
          base.toUpperCase(),
          quoteSym.toUpperCase(),
          beforeTs
        );
      },

      fetchOpeningGrid: async (coinsUniverse, nowTsParam) => {
        const ref = await fetchOpeningGridFromView({
          coins: coinsUniverse,
          window,
          appSessionId,
          openingTs: undefined,
        });
        lastOpeningTs = ref.ts ?? nowTsParam;
        return { ts: ref.ts ?? nowTsParam, grid: ref.grid };
      },
    });

    const derived = await computeFromDbAndLive({
      coins: coins.slice(),
      nowTs,
      liveBenchmark: bmGrid,
    });

    const bmValues = pickValues(coins, live.matrices.benchmark.values);
    const pct24Values = pickValues(coins, live.matrices.pct24h.values);
    const idPctValues = toValues(coins, derived.id_pct);
    const drvValues = toValues(coins, derived.pct_drv);
    const pctRefValues = toValues(coins, derived.pct_ref);
    const refValues = toValues(coins, derived.ref);
    const deltaValues = toValues(coins, derived.delta);

    const symbols: string[] = [];
    for (let i = 0; i < coins.length; i++) {
      for (let j = 0; j < coins.length; j++) {
        if (i === j) continue;
        symbols.push(`${coins[i]}${coins[j]}`);
      }
    }

    const coinsDisplay = coins.filter((c) => c !== quote);

    return {
      ok: true,
      coins: coinsDisplay,
      symbols,
      quote,
      window,
      ts: nowTs,
      matrices: {
        benchmark: {
          ts: nowTs,
          values: bmValues,
          flags: live.matrices.benchmark.flags,
        },
        pct24h: {
          ts: nowTs,
          values: pct24Values,
          flags: live.matrices.pct24h.flags,
        },
        id_pct: { ts: nowTs, values: idPctValues },
        pct_drv: { ts: nowTs, values: drvValues },
        pct_ref: { ts: nowTs, values: pctRefValues },
        ref: { ts: nowTs, values: refValues },
        delta: { ts: nowTs, values: deltaValues },
      },
      meta: {
        openingTs: lastOpeningTs,
        universe: coins,
      },
    } satisfies MatricesLatestSuccessPayload;
  } catch (err: any) {
    console.error("[matrices/latest] error:", err);
    return {
      ok: false,
      error: String(err?.message ?? err),
    } satisfies MatricesLatestErrorPayload;
  }
}

export async function GET(req: Request) {
  const q = parseQuery(req);
  const payload = await buildMatricesLatestPayload(q);
  const status = payload.ok ? 200 : 500;
  return NextResponse.json(payload, { status });
}

export default async function handler(_req: NextApiRequest, res: NextApiResponse) {
  try {
    const sql = `
      SELECT dv.*
      FROM matrices.dyn_values dv
      JOIN settings.coin_universe cu
        ON cu.base_asset = dv.base
       AND cu.quote_asset = dv.quote
       AND cu.enabled = true
      WHERE dv.matrix_type = 'benchmark'
        AND dv.ts_ms = (
          SELECT MAX(ts_ms)
          FROM matrices.dyn_values d2
          WHERE d2.matrix_type = dv.matrix_type
            AND d2.base = dv.base
            AND d2.quote = dv.quote
        )
      ORDER BY COALESCE(cu.sort_order, 999), dv.base
    `;
    const { rows } = await query(sql);
    res.status(200).json(rows);
  } catch (e: any) {
    res.status(500).json({ error: e?.message ?? "unknown error" });
  }
}
