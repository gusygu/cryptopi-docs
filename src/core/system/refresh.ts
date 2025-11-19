// src/core/system/refresh.ts
import { fetchCoinUniverseEntries, fetchPairUniverseCoins } from "@/lib/settings/coin-universe";
import { ingestTickerSymbols, ingestKlinesSymbols } from "./tasks";
import { query } from "@/core/db/pool_server";
import { liveFromSources } from "@/core/features/matrices/liveFromSources";
import {
  configureBenchmarkProviders,
  computeFromDbAndLive,
} from "@/core/maths/math";
import {
  stageMatrixGrid,
  commitMatrixGrid,
  getPrevValue,
  persistLiveMatricesSlice,
} from "@/core/db/db";
import type { MatrixGridObject, MatrixType } from "@/core/db/db";
import { fetchOpeningGridFromView } from "@/core/features/matrices/opening";

export type RefreshStepResult = {
  name: string;
  ok: boolean;
  durationMs: number;
  details?: Record<string, unknown>;
  error?: string;
};

export type SystemRefreshResult = {
  ok: boolean;
  startedAt: number;
  finishedAt: number;
  symbols: string[];
  steps: RefreshStepResult[];
};

type RefreshOptions = {
  symbols?: string[];
  klinesInterval?: string;
  recordTelemetry?: boolean;
  pollerId?: string;
  window?: string;
};

const KNOWN_QUOTES = ["USDT", "FDUSD", "USDC", "TUSD", "BUSD", "USD", "BTC", "ETH", "BNB"] as const;
const REFRESH_WINDOW = process.env.MATRICES_REFRESH_WINDOW ?? "1h";
const APP_SESSION_ID = process.env.APP_SESSION_ID ?? "system-refresh";

export async function runSystemRefresh(opts: RefreshOptions = {}): Promise<SystemRefreshResult> {
  const universeEntries = opts.symbols
    ? opts.symbols.map((sym) => {
        const { base, quote } = splitSymbol(sym);
        return { symbol: sym.toUpperCase(), base, quote };
      })
    : await fetchCoinUniverseEntries({ onlyEnabled: true });

  const symbolList = universeEntries.map((entry) => entry.symbol.toUpperCase());
  const pairUniverseCoins = await fetchPairUniverseCoins();

  if (!symbolList.length) {
    throw new Error("coin universe is empty");
  }

  const startedAt = Date.now();
  const steps: RefreshStepResult[] = [];

  const runStep = async <T>(
    name: string,
    fn: () => Promise<T>,
    mapDetails?: (value: T) => Record<string, unknown>
  ) => {
    const t0 = Date.now();
    try {
      const value = await fn();
      const durationMs = Date.now() - t0;
      steps.push({
        name,
        ok: true,
        durationMs,
        details: mapDetails ? mapDetails(value) : undefined,
      });
    } catch (err: any) {
      const durationMs = Date.now() - t0;
      steps.push({
        name,
        ok: false,
        durationMs,
        error: String(err?.message ?? err),
      });
    }
  };

  await runStep("ticker", () => ingestTickerSymbols(symbolList), (count) => ({ wrote: count as number }));

  const klinesInterval = opts.klinesInterval ?? "1m";
  await runStep(
    `klines:${klinesInterval}`,
    () => ingestKlinesSymbols(symbolList, klinesInterval, 200),
    (count) => ({ wrote: count as number })
  );

  await runStep("matrices:persist", async () => {
    const fallbackCoins = dedupeCoins([
      ...universeEntries
        .map((entry) => entry.base || splitSymbol(entry.symbol).base)
        .filter(Boolean),
      "USDT",
    ]);
    const coins = pairUniverseCoins.length
      ? dedupeCoins([...pairUniverseCoins, ...fallbackCoins])
      : fallbackCoins;

    const live = await liveFromSources(coins);
    const liveCoins = live.coins;
    if (!liveCoins.length) {
      throw new Error("liveFromSources returned no coins");
    }

    const tsMs = live.matrices.benchmark.ts;

    await persistLiveMatricesSlice({
      appSessionId: APP_SESSION_ID,
      coins: liveCoins,
      tsMs,
      benchmark: live.matrices.benchmark.values,
      pct24h: live.matrices.pct24h.values,
      idemPrefix: `refresh:${opts.pollerId ?? "default"}`,
    });

    configureBenchmarkProviders({
      getPrev: (matrixType, base, quote, beforeTs) =>
        getPrevValue(matrixType, base.toUpperCase(), quote.toUpperCase(), beforeTs),
      fetchOpeningGrid: (coinsUniverse, nowTsParam) =>
        fetchOpeningGridFromView({
          coins: coinsUniverse,
          appSessionId: APP_SESSION_ID,
          window: opts.window ?? REFRESH_WINDOW,
          openingTs: undefined,
        }),
    });

    const derived = await computeFromDbAndLive({
      coins: liveCoins,
      nowTs: tsMs,
      liveBenchmark: valuesToGrid(liveCoins, live.matrices.benchmark.values),
    });

    await persistDerivedGrid({
      appSessionId: APP_SESSION_ID,
      matrixType: "pct_drv",
      tsMs,
      coins: liveCoins,
      grid: derived.pct_drv,
      meta: { source: "derived@refresh" },
    });
    await persistDerivedGrid({
      appSessionId: APP_SESSION_ID,
      matrixType: "pct_ref",
      tsMs,
      coins: liveCoins,
      grid: derived.pct_ref,
      meta: { source: "derived@refresh" },
    });
    await persistDerivedGrid({
      appSessionId: APP_SESSION_ID,
      matrixType: "ref",
      tsMs,
      coins: liveCoins,
      grid: derived.ref,
      meta: { source: "derived@refresh" },
    });
    await persistDerivedGrid({
      appSessionId: APP_SESSION_ID,
      matrixType: "delta",
      tsMs,
      coins: liveCoins,
      grid: derived.delta,
      meta: { source: "derived@refresh" },
    });

    return { coins: liveCoins.length, ts: tsMs };
  });

  const ok = steps.every((s) => s.ok);
  const finishedAt = Date.now();

  if (opts.recordTelemetry !== false) {
    await recordTelemetry({
      pollerId: opts.pollerId ?? "default",
      ok,
      durationMs: finishedAt - startedAt,
      error: ok ? null : steps.find((s) => !s.ok)?.error ?? null,
    });
  }

  return {
    ok,
    startedAt,
    finishedAt,
    symbols: symbolList,
    steps,
  };
}

function splitSymbol(symbol: string): { base: string; quote: string } {
  const upper = String(symbol || "").toUpperCase();
  for (const quote of KNOWN_QUOTES) {
    if (upper.endsWith(quote) && upper.length > quote.length) {
      return { base: upper.slice(0, -quote.length), quote };
    }
  }
  return { base: upper, quote: "USDT" };
}

function dedupeCoins(list: string[]): string[] {
  const set = new Set<string>();
  for (const entry of list) {
    const coin = String(entry || "").toUpperCase().trim();
    if (!coin) continue;
    set.add(coin);
  }
  return Array.from(set);
}

function valuesToGrid(coins: string[], values: Record<string, Record<string, number | null>>): (number | null)[][] {
  const grid: (number | null)[][] = Array.from({ length: coins.length }, () =>
    Array.from({ length: coins.length }, () => null)
  );
  for (let i = 0; i < coins.length; i++) {
    const bi = coins[i]!;
    const row = values[bi] || {};
    for (let j = 0; j < coins.length; j++) {
      if (i === j) continue;
      const qj = coins[j]!;
      const v = row[qj];
      grid[i][j] = v == null ? null : Number(v);
    }
  }
  return grid;
}

function gridToValues(coins: string[], grid: (number | null)[][]): MatrixGridObject {
  const out: MatrixGridObject = {};
  for (let i = 0; i < coins.length; i++) {
    const bi = coins[i]!;
    out[bi] = {} as Record<string, number | null>;
    for (let j = 0; j < coins.length; j++) {
      if (i === j) continue;
      const qj = coins[j]!;
      out[bi][qj] = grid[i][j] ?? null;
    }
  }
  return out;
}

async function persistDerivedGrid(opts: {
  appSessionId: string;
  matrixType: MatrixType;
  tsMs: number;
  coins: string[];
  grid: (number | null)[][];
  meta?: any;
}) {
  const values = gridToValues(opts.coins, opts.grid);
  await stageMatrixGrid({
    appSessionId: opts.appSessionId,
    matrixType: opts.matrixType,
    tsMs: opts.tsMs,
    coins: opts.coins,
    values,
    meta: opts.meta,
  });
  await commitMatrixGrid({
    appSessionId: opts.appSessionId,
    matrixType: opts.matrixType,
    tsMs: opts.tsMs,
    coins: opts.coins,
    idem: `refresh:${opts.matrixType}:${opts.tsMs}`,
  });
}

async function recordTelemetry(input: {
  pollerId: string;
  ok: boolean;
  durationMs: number;
  error: string | null;
}) {
  try {
    await query(
      `
        insert into settings.poller_state(poller_id, last_run_at, last_status, last_error, duration_ms, updated_at)
        values ($1, now(), $2, $3, $4, now())
        on conflict (poller_id) do update
          set last_run_at = excluded.last_run_at,
              last_status = excluded.last_status,
              last_error = excluded.last_error,
              duration_ms = excluded.duration_ms,
              updated_at = excluded.updated_at
      `,
      [input.pollerId, input.ok ? "ok" : "error", input.error, input.durationMs]
    );
  } catch (err) {
    console.warn("[system] unable to persist poller_state:", err);
  }
}
