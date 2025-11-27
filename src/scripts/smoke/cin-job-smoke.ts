import "dotenv/config";
import { setTimeout as sleep } from "node:timers/promises";
import { db } from "@/core/db/db";
import {
  getMyTradesForSymbol,
  getConvertTradeFlow,
  type AccountTrade,
} from "@/core/sources/binanceAccount";
import {
  insertAccountTrade,
  insertConvertTrade,
  getLastConvertTradeMs,
  primeAssetPriceCache,
} from "@/scripts/jobs/lib/cinTradeIngest";
import { resolveAccountScope } from "@/core/features/cin-aux/accountScope";
import { isWeightLimitError, formatWeightLimitMessage } from "@/scripts/jobs/lib/binanceRateLimit";

const sessionId = Number(
  process.env.CIN_SMOKE_SESSION_ID ??
    process.env.CIN_RUNTIME_SESSION_ID ??
    process.env.CIN_WATCH_SESSION_ID ??
    "",
);
if (!Number.isFinite(sessionId) || sessionId <= 0) {
  throw new Error("Set CIN_SMOKE_SESSION_ID (or CIN_RUNTIME_SESSION_ID) with the runtime session id to test.");
}

const lookbackDays = Math.max(1, Number(process.env.CIN_SMOKE_LOOKBACK_DAYS ?? 7));
const SYMBOL_DELAY_MS = Math.max(0, Number(process.env.CIN_SMOKE_SYMBOL_DELAY_MS ?? 200));
const DAY_MS = 24 * 60 * 60 * 1000;
const CONVERT_LOOKBACK_DAYS = Math.max(
  1,
  Number(process.env.CIN_SMOKE_CONVERT_LOOKBACK_DAYS ?? lookbackDays),
);
const CONVERT_LIMIT = Math.min(1000, Number(process.env.CIN_SMOKE_CONVERT_LIMIT ?? 200));
const CONVERT_ENABLED = process.env.CIN_SMOKE_CONVERT === "0" ? false : true;
const WEIGHT_BACKOFF_MS = Math.max(5000, Number(process.env.CIN_SMOKE_WEIGHT_BACKOFF_MS ?? 60000));

let scopeCache = "__env__";
let lastConvertTimeMs: number | null = null;

async function fetchMaxTradeId(symbol: string): Promise<bigint | null> {
  const { rows } = await db.query<{ max_id: string | null }>(
    `select max(trade_id) as max_id
       from market.account_trades
      where symbol = $1
        and (account_email is not distinct from $2)`,
    [symbol, scopeCache],
  );
  const value = rows[0]?.max_id;
  return value != null ? BigInt(value) : null;
}

async function resolveSymbols(): Promise<string[]> {
  const envList = process.env.CIN_SMOKE_SYMBOLS;
  if (envList && envList.trim() && envList.trim() !== "*") {
    return Array.from(
      new Set(
        envList
          .split(",")
          .map((s) => s.trim().toUpperCase())
          .filter(Boolean),
      ),
    );
  }

  const { rows } = await db.query<{ base_asset: string | null }>(
    `
      SELECT DISTINCT base_asset
        FROM settings.coin_universe
       WHERE enabled = TRUE
         AND base_asset IS NOT NULL
    `,
  );
  const symbols: string[] = [];
  for (const row of rows) {
    const base = String(row.base_asset ?? "").trim().toUpperCase();
    if (base && base !== "USDT") {
      symbols.push(`${base}USDT`);
    }
  }
  if (!symbols.length) {
    throw new Error(
      "No symbols available. Set CIN_SMOKE_SYMBOLS or enable entries in settings.coin_universe.",
    );
  }
  return symbols.sort();
}

async function ensureConvertCursor(now: number): Promise<number> {
  if (lastConvertTimeMs == null) {
    lastConvertTimeMs = await getLastConvertTradeMs(scopeCache);
  }
  if (lastConvertTimeMs != null) {
    return Math.min(lastConvertTimeMs + 1, now);
  }
  return now - CONVERT_LOOKBACK_DAYS * DAY_MS;
}

async function syncConvertTrades(now: number): Promise<number> {
  if (!CONVERT_ENABLED) return 0;
  const startTime = await ensureConvertCursor(now);
  if (startTime >= now) return 0;
  const trades = await getConvertTradeFlow({
    email: scopeCache === "__env__" ? undefined : scopeCache,
    startTime,
    endTime: now,
    limit: CONVERT_LIMIT,
  });
  if (!trades.length) return 0;
  const assetsToPrime = new Set<string>();
  for (const entry of trades) {
    const base = String(entry.toAsset ?? "").trim().toUpperCase();
    const quote = String(entry.fromAsset ?? "").trim().toUpperCase();
    if (base && base !== "USDT") assetsToPrime.add(base);
    if (quote && quote !== "USDT") assetsToPrime.add(quote);
  }
  if (assetsToPrime.size) {
    await primeAssetPriceCache(Array.from(assetsToPrime));
  }
  trades.sort((a, b) => Number(a.createTime) - Number(b.createTime));
  let inserted = 0;
  for (const entry of trades) {
    if (await insertConvertTrade(entry, scopeCache)) {
      inserted += 1;
      lastConvertTimeMs = Math.max(lastConvertTimeMs ?? 0, Number(entry.createTime));
    }
  }
  return inserted;
}

async function run() {
  scopeCache = await resolveAccountScope(
    process.env.CIN_SMOKE_EMAIL ?? process.env.CIN_WATCH_ACCOUNT_SCOPE,
  );
  const symbols = await resolveSymbols();
  console.log(
    `[cin-job-smoke] Running single watcher tick for session ${sessionId} (scope: ${scopeCache}, symbols: ${symbols.join(", ")})`,
  );
  const now = Date.now();
  let importedTrades = 0;
  let weightLimited = false;

  for (const symbol of symbols) {
    try {
      const lastTradeId = await fetchMaxTradeId(symbol);
      const fromId = lastTradeId != null ? Number(lastTradeId + 1n) : undefined;
      const startTime =
        lastTradeId == null ? now - lookbackDays * 24 * 60 * 60 * 1000 : undefined;
      const trades = await getMyTradesForSymbol(symbol, {
        email: scopeCache === "__env__" ? undefined : scopeCache,
        fromId,
        startTime,
      });

      for (const trade of trades) {
        if (await insertAccountTrade(symbol, trade, scopeCache)) {
          importedTrades += 1;
        }
      }
      if (SYMBOL_DELAY_MS > 0) {
        await sleep(SYMBOL_DELAY_MS);
      }
    } catch (err) {
      if (isWeightLimitError(err)) {
        console.warn(formatWeightLimitMessage("cin-job-smoke", WEIGHT_BACKOFF_MS));
        weightLimited = true;
        break;
      }
      throw err;
    }
  }

  let convertInserted = 0;
  if (!weightLimited) {
    try {
      convertInserted = await syncConvertTrades(now);
    } catch (err) {
      if (isWeightLimitError(err)) {
        console.warn(formatWeightLimitMessage("cin-job-smoke", WEIGHT_BACKOFF_MS));
      } else {
        throw err;
      }
    }
  } else {
    console.warn("[cin-job-smoke] skipping convert ingestion due to weight limit.");
  }

  const { rows } = await db.query<{ import_moves_from_account_trades: number }>(
    `select cin_aux.import_moves_from_account_trades($1,$2)`,
    [sessionId, scopeCache],
  );
  const importedMoves = rows[0]?.import_moves_from_account_trades ?? 0;

  console.log(
    `[cin-job-smoke] Done - trades inserted: ${importedTrades} (convert: ${convertInserted}), moves imported: ${importedMoves}`,
  );
}

void run();
