// src/core/pipelines/pipeline.ts
// Pure plumbing: API -> DB using coin_universe as the source of truth

import type { PipelineContext, OrchestratorCtx, PollTick } from "./types.ts";
import { fetchLiveSnapshotBasic } from "./pipeline.api.ts";
import { appendAppLedger, query } from "../db/pool_server.ts";
import {
  persistLiveMatricesSlice,
  type MatrixGridObject,
} from "../db/db.ts";

/** Load matrices bases/quote from env -> DB coin_universe -> fallback */
async function loadMatricesConfig() {
  const envBases = process.env.MATRICES_BASES?.split(",")
    .map(s => s.trim().toUpperCase()).filter(Boolean);
  const envQuote = (process.env.MATRICES_QUOTE ?? "USDT").toUpperCase();

  if (envBases?.length) return { bases: envBases, quote: envQuote };

  // DB coin_universe (enabled)
  const { rows } = await query<{ base_asset: string; quote_asset: string; sort_order: number | null }>(`
    SELECT base_asset, quote_asset, sort_order
    FROM settings.coin_universe
    WHERE enabled = true
    ORDER BY COALESCE(sort_order, 999), base_asset
  `);

  if (rows.length) {
    const bases = rows.map(r => r.base_asset.toUpperCase());
    const quote = rows[0].quote_asset?.toUpperCase() || envQuote;
    return { bases, quote };
  }

  // Final fallback (rare): small safe set
  return { bases: ["BTC","ETH","BNB"], quote: envQuote };
}

type CycleSnapshot = Awaited<ReturnType<typeof fetchLiveSnapshotBasic>>;

export type MatricesCycleResult = {
  ts_ms: number;
  bases: string[];
  coins: string[];
  quote: string;
  matrices: {
    benchmark: MatrixGridObject;
    pct24h: MatrixGridObject;
  };
  snapshot: CycleSnapshot;
  orderBooks: CycleSnapshot["orderBooks"];
  wallet: CycleSnapshot["wallet"];
  persisted: boolean;
};

export async function runOrchestrator(
  ctx: OrchestratorCtx,
  hooks: { subscribe: () => AsyncIterable<PollTick>; onCycleDone?: (t: PollTick) => any }
) {
  // source of truth for bases/quote:
  const matrices = ctx.settings?.matrices ?? await loadMatricesConfig();

  for await (const tick of hooks.subscribe()) {
    try {
      const snapshot = await fetchLiveSnapshotBasic(
        matrices.bases,
        matrices.quote,
        { tick, settings: { matrices } as any, logger: ctx.logger }
      );

      await runMatricesCycle({ ...ctx, settings: { matrices } } as any, tick, snapshot);
      await hooks.onCycleDone?.(tick);
    } catch (err) {
      ctx.logger?.error?.("orchestrator:error", err);
    }
  }
}

export async function runMatricesCycle(
  ctx: OrchestratorCtx | PipelineContext,
  tick: PollTick,
  snapshot: CycleSnapshot
): Promise<MatricesCycleResult> {
  const S = ctx.settings.matrices;
  const baseList = Array.from(
    new Set((S.bases ?? []).map((b) => String(b || "").toUpperCase()).filter(Boolean))
  );
  const quote = String(S.quote || "USDT").toUpperCase();
  const coins = [quote, ...baseList.filter((c) => c !== quote)];
  const tsMs = tick.cycleTs;

  const sanitizePairMap = (source?: Record<string, unknown>): Record<string, number> => {
    const out: Record<string, number> = {};
    if (!source) return out;
    for (const [rawKey, rawValue] of Object.entries(source)) {
      const key = String(rawKey ?? "").toUpperCase();
      const num = Number(rawValue);
      if (Number.isFinite(num)) out[key] = num;
    }
    return out;
  };

  const pairKey = (a: string, b: string) => `${a.toUpperCase()}/${b.toUpperCase()}`;

  const resolvePair = (
    base: string,
    quoteSym: string,
    primary: Record<string, number>,
    bridge: Record<string, number>
  ): number | null => {
    if (base === quoteSym) return null;
    const directKey = pairKey(base, quoteSym);
    const directVal = primary[directKey];
    if (Number.isFinite(directVal)) return directVal;

    const inverseKey = pairKey(quoteSym, base);
    const inverseVal = primary[inverseKey];
    if (Number.isFinite(inverseVal) && inverseVal !== 0) return 1 / inverseVal;

    const bridgeBase = bridge[pairKey(base, "USDT")];
    const bridgeQuote = bridge[pairKey(quoteSym, "USDT")];
    if (Number.isFinite(bridgeBase) && Number.isFinite(bridgeQuote) && bridgeQuote !== 0) {
      return bridgeBase / bridgeQuote;
    }
    return null;
  };

  const buildMatrix = (
    universe: string[],
    resolver: (base: string, quoteSym: string) => number | null
  ): MatrixGridObject => {
    const grid: MatrixGridObject = {};
    for (const base of universe) {
      const row: Record<string, number | null> = {};
      for (const quoteSym of universe) {
        if (base === quoteSym) continue;
        const value = resolver(base, quoteSym);
        row[quoteSym] = value != null && Number.isFinite(value) ? value : null;
      }
      grid[base] = row;
    }
    return grid;
  };

  const countFiniteCells = (grid: MatrixGridObject): number => {
    let count = 0;
    for (const row of Object.values(grid)) {
      for (const value of Object.values(row ?? {})) {
        if (value != null && Number.isFinite(value)) count += 1;
      }
    }
    return count;
  };

  const priceBook = snapshot.priceBook ?? { direct: {}, open24h: {}, usdt: {} };
  const directMap = sanitizePairMap(priceBook.direct as Record<string, unknown>);
  const openMap = sanitizePairMap(priceBook.open24h as Record<string, unknown>);
  const usdtMap = sanitizePairMap(priceBook.usdt as Record<string, unknown>);
  usdtMap[pairKey("USDT", "USDT")] = 1;

  const benchmarkValues = buildMatrix(coins, (base, quoteSym) =>
    resolvePair(base, quoteSym, directMap, usdtMap)
  );

  const openBridge: Record<string, number> = { [pairKey("USDT", "USDT")]: 1 };
  for (const [key, value] of Object.entries(openMap)) {
    if (key.endsWith("/USDT") && Number.isFinite(value)) {
      openBridge[key] = value;
    }
  }

  const pct24hValues = buildMatrix(coins, (base, quoteSym) => {
    const current = benchmarkValues[base]?.[quoteSym] ?? null;
    if (current == null || !Number.isFinite(current)) return null;
    const openVal = resolvePair(base, quoteSym, openMap, openBridge);
    if (openVal == null || !Number.isFinite(openVal) || Math.abs(openVal) < 1e-12) {
      return null;
    }
    return (current - openVal) / openVal;
  });

  const finiteBenchmarkCells = countFiniteCells(benchmarkValues);
  let persisted = false;

  if (S.persist) {
    const appSessionId =
      tick.appSessionId ??
      process.env.MATRIX_APP_SESSION ??
      "matrices-pipeline";

    await persistLiveMatricesSlice({
      appSessionId,
      coins,
      tsMs,
      benchmark: benchmarkValues,
      pct24h: pct24hValues,
      idemPrefix: "pipeline",
    });
    persisted = true;
  }

  await appendAppLedger({
    topic: "pipeline",
    event: "matrices_upsert",
    payload: {
      bases: baseList,
      coins,
      quote,
      cells: finiteBenchmarkCells,
      persisted,
      ts_ms: tsMs,
    },
    ts_epoch_ms: Date.now(),
  });

  const action = persisted ? "persisted" : "computed";
  ctx.logger?.info?.(
    `[matrices] ${action} ${finiteBenchmarkCells} benchmark cells @ ${tsMs}`
  );

  return {
    ts_ms: tsMs,
    bases: baseList,
    coins,
    quote,
    matrices: {
      benchmark: benchmarkValues,
      pct24h: pct24hValues,
    },
    snapshot,
    orderBooks: snapshot.orderBooks,
    wallet: snapshot.wallet,
    persisted,
  };
}

