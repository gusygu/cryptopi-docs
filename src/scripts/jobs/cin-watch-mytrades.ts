// src/scripts/jobs/cin-watch-mytrades.ts
//
// Poll /api/v3/myTrades for a list of symbols at a very short cadence and
// stream results into market.account_trades + cin_aux runtime moves.
//
// Usage:
//   CIN_RUNTIME_SESSION_ID=10 pnpm tsx src/scripts/jobs/cin-watch-mytrades.ts
//
// Optional env vars:
//   CIN_WATCH_SYMBOLS        comma-separated list (e.g. "BNBUSDT,ETHUSDT")
//   CIN_WATCH_ACCOUNT_SCOPE  logical account label stored in account_trades (default: "__env__")
//   CIN_WATCH_POLL_MS        delay between loops (default: 5000ms)
//   CIN_WATCH_LOOKBACK_DAYS  bootstrap lookback when no trades exist (default: 7)
//
// The job relies on BINANCE_API_KEY / BINANCE_API_SECRET (or compatible env
// vars consumed by getMyTradesForSymbol) and will run indefinitely until
// interrupted (Ctrl+C).

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
import { setServerRequestContext } from "@/lib/server/request-context";
import { insertUserCycleLog } from "@/lib/server/audit-log";

const SESSION_ID = Number(
  process.env.CIN_WATCH_SESSION_ID ?? process.env.CIN_RUNTIME_SESSION_ID ?? "",
);
if (!Number.isFinite(SESSION_ID) || SESSION_ID <= 0) {
  throw new Error(
    "Set CIN_WATCH_SESSION_ID or CIN_RUNTIME_SESSION_ID with a positive runtime session id to update.",
  );
}

async function ensureSessionExists(id: number) {
  const { rowCount } = await db.query(
    `select 1 from cin_aux.rt_session where session_id = $1`,
    [id],
  );
  if (!rowCount) {
    throw new Error(
      `Runtime session ${id} not found in cin_aux.rt_session. Create/open a session in /cin and pass its id via CIN_WATCH_SESSION_ID.`,
    );
  }
}

let ACCOUNT_SCOPE = "__env__";
const POLL_MS = Math.max(1000, Number(process.env.CIN_WATCH_POLL_MS ?? 5000));
const LOOKBACK_DAYS = Math.max(1, Number(process.env.CIN_WATCH_LOOKBACK_DAYS ?? 7));
const SYMBOLS_PER_TICK = Math.max(
  1,
  Number(process.env.CIN_WATCH_SYMBOLS_PER_TICK ?? 2),
);
const SYMBOL_DELAY_MS = Math.max(0, Number(process.env.CIN_WATCH_SYMBOL_DELAY_MS ?? 200));
const DAY_MS = 24 * 60 * 60 * 1000;
const CONVERT_ENABLED = process.env.CIN_WATCH_CONVERT === "0" ? false : true;
const CONVERT_LOOKBACK_DAYS = Math.max(
  1,
  Number(process.env.CIN_WATCH_CONVERT_LOOKBACK_DAYS ?? LOOKBACK_DAYS),
);
const CONVERT_LIMIT = Math.min(1000, Number(process.env.CIN_WATCH_CONVERT_LIMIT ?? 200));
const WEIGHT_BACKOFF_MS = Math.max(5000, Number(process.env.CIN_WATCH_WEIGHT_BACKOFF_MS ?? 60000));
let lastConvertTimeMs: number | null = null;
let weightBlockedUntil = 0;

type CycleStatus = "ok" | "warn" | "idle" | "error";
type CycleLogger = (status: CycleStatus, summary: string, payload?: Record<string, unknown>) => Promise<void>;

async function resolveRuntimeSessionOwner(sessionId: number): Promise<string> {
  const { rows } = await db.query<{ owner_user_id: string | null }>(
    `select owner_user_id from cin_aux.rt_session where session_id = $1`,
    [sessionId],
  );
  const owner = rows[0]?.owner_user_id;
  if (!owner) {
    throw new Error(
      `Runtime session ${sessionId} has no owner_user_id. Assign one via /api/cin-aux/runtime before running cin-watch.`,
    );
  }
  return owner;
}

async function resolveNextCycleSeq(ownerUserId: string): Promise<number> {
  const { rows } = await db.query<{ max_seq: string | null }>(
    `select max(cycle_seq) as max_seq from audit.user_cycle_log where owner_user_id = $1`,
    [ownerUserId],
  );
  const prev = rows[0]?.max_seq;
  return prev != null ? Number(prev) + 1 : 0;
}

function createCycleLogger(params: {
  ownerUserId: string;
  sessionId: number;
  initialSeq: number;
}): CycleLogger {
  let seq = params.initialSeq;
  return async (status, summary, payload) => {
    try {
      await insertUserCycleLog({
        ownerUserId: params.ownerUserId,
        cycleSeq: seq,
        sessionId: null,
        status,
        summary,
        payload: {
          runtime_session_id: params.sessionId,
          account_scope: ACCOUNT_SCOPE,
          ...(payload ?? {}),
        },
      });
    } catch (err) {
      console.warn("[cin-watch] failed to record audit.user_cycle_log", err);
    } finally {
      seq += 1;
    }
  };
}

type CursorMap = Map<string, bigint>;
const lastTradeIdBySymbol: CursorMap = new Map();

async function fetchSymbols(): Promise<string[]> {
  const envList = process.env.CIN_WATCH_SYMBOLS;
  if (envList) {
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
    throw new Error("No symbols found. Set CIN_WATCH_SYMBOLS or populate settings.coin_universe.");
  }
  return symbols.sort();
}

async function hydrateCursors(symbols: string[]) {
  for (const symbol of symbols) {
    const { rows } = await db.query<{ max_id: string | null }>(
      `select max(trade_id) as max_id
         from market.account_trades
        where symbol = $1
          and (account_email is not distinct from $2)`,
      [symbol, ACCOUNT_SCOPE],
    );
    const maxIdStr = rows[0]?.max_id;
    if (maxIdStr != null) {
      lastTradeIdBySymbol.set(symbol, BigInt(maxIdStr));
    }
  }
}

async function syncSymbol(symbol: string, now: number) {
  if (Date.now() < weightBlockedUntil) return 0;
  const lastTradeId = lastTradeIdBySymbol.get(symbol);
  const fromId = lastTradeId != null ? Number(lastTradeId + 1n) : undefined;
  const startTime =
    lastTradeId == null ? now - LOOKBACK_DAYS * 24 * 60 * 60 * 1000 : undefined;
  const trades = await getMyTradesForSymbol(symbol, {
    email: ACCOUNT_SCOPE === "__env__" ? undefined : ACCOUNT_SCOPE,
    fromId,
    startTime,
  });
  if (!trades.length) return 0;

  let inserted = 0;
  for (const t of trades) {
    const stored = await insertAccountTrade(symbol, t, ACCOUNT_SCOPE);
    if (stored) {
      lastTradeIdBySymbol.set(symbol, BigInt(t.id));
      inserted += 1;
    }
  }
  return inserted;
}

async function importMoves() {
  const { rows } = await db.query<{ import_moves_from_account_trades: number }>(
    `select cin_aux.import_moves_from_account_trades($1,$2)`,
    [SESSION_ID, ACCOUNT_SCOPE],
  );
  return rows[0]?.import_moves_from_account_trades ?? 0;
}

async function ensureConvertCursor(now: number): Promise<number> {
  if (lastConvertTimeMs == null) {
    lastConvertTimeMs = await getLastConvertTradeMs(ACCOUNT_SCOPE);
  }
  if (lastConvertTimeMs != null) {
    return Math.min(lastConvertTimeMs + 1, now);
  }
  return now - CONVERT_LOOKBACK_DAYS * DAY_MS;
}

async function syncConvertTrades(now: number): Promise<number> {
  if (!CONVERT_ENABLED) return 0;
  if (Date.now() < weightBlockedUntil) return 0;
  const startTime = await ensureConvertCursor(now);
  const endTime = now;
  if (startTime >= endTime) return 0;
  const trades = await getConvertTradeFlow({
    email: ACCOUNT_SCOPE === "__env__" ? undefined : ACCOUNT_SCOPE,
    startTime,
    endTime,
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
    if (await insertConvertTrade(entry, ACCOUNT_SCOPE)) {
      inserted += 1;
      lastConvertTimeMs = Math.max(lastConvertTimeMs ?? 0, Number(entry.createTime));
    }
  }
  return inserted;
}

async function loop(symbols: string[], recordCycleLog: CycleLogger) {
  let nextSymbolIdx = 0;

  console.log(
    `[cin-watch] watching ${symbols.length} symbol(s) for session ${SESSION_ID} as scope "${ACCOUNT_SCOPE}".`,
  );

  while (true) {
    const tickStarted = Date.now();
    const batch: string[] = [];

    try {
      let importedTrades = 0;
      let importedMoves = 0;
      let convertTrades = 0;

      for (let i = 0; i < SYMBOLS_PER_TICK; i += 1) {
        const symbol = symbols[nextSymbolIdx];
        batch.push(symbol);
        nextSymbolIdx = (nextSymbolIdx + 1) % symbols.length;
      }

      for (const symbol of batch) {
        importedTrades += await syncSymbol(symbol, tickStarted);
        if (SYMBOL_DELAY_MS > 0) {
          await sleep(SYMBOL_DELAY_MS);
        }
      }

      convertTrades = await syncConvertTrades(tickStarted);
      importedTrades += convertTrades;
      importedMoves = await importMoves();

      if (importedTrades || importedMoves) {
        console.log(
          `[cin-watch] ${new Date().toISOString()} → trades:${importedTrades} moves:${importedMoves}`,
        );
      }

      const status: CycleStatus = importedTrades || importedMoves ? "ok" : "idle";
      const summary =
        status === "ok"
          ? `synced ${importedTrades} trade(s), ${importedMoves} move(s)`
          : "no updates";

      await recordCycleLog(status, summary, {
        symbols_batch: batch,
        imported_trades: importedTrades,
        imported_moves: importedMoves,
        convert_trades: convertTrades,
        tick_started_at: tickStarted,
        tick_finished_at: Date.now(),
      });
    } catch (err) {
      if (isWeightLimitError(err)) {
        weightBlockedUntil = Math.max(weightBlockedUntil, Date.now() + WEIGHT_BACKOFF_MS);
        const summary = formatWeightLimitMessage("cin-watch", WEIGHT_BACKOFF_MS);
        console.warn(summary);
        await recordCycleLog("warn", summary, {
          symbols_batch: batch,
          blocked_until: weightBlockedUntil,
        });
      } else {
        const message = err instanceof Error ? err.message : String(err ?? "tick failed");
        console.error("[cin-watch] tick failed", err);
        await recordCycleLog("error", message, {
          symbols_batch: batch,
          error: message,
          stack: err instanceof Error ? err.stack : null,
        });
      }
    }

    const elapsed = Date.now() - tickStarted;
    const now = Date.now();
    const backoff = Math.max(0, weightBlockedUntil - now);
    if (backoff > 0) {
      console.warn(formatWeightLimitMessage("cin-watch", backoff));
      await sleep(backoff);
      weightBlockedUntil = 0;
    }
    const wait = Math.max(1000, POLL_MS - elapsed);
    await sleep(wait);
  }
}

async function main() {
  ACCOUNT_SCOPE = await resolveAccountScope(process.env.CIN_WATCH_ACCOUNT_SCOPE);
  console.log(`[cin-watch] using account scope "${ACCOUNT_SCOPE}".`);
  await ensureSessionExists(SESSION_ID);
  const ownerUserId = await resolveRuntimeSessionOwner(SESSION_ID);
  setServerRequestContext({ userId: ownerUserId, isAdmin: false });
  const symbols = await fetchSymbols();
  await hydrateCursors(symbols);
  const initialSeq = await resolveNextCycleSeq(ownerUserId);
  const recordCycleLog = createCycleLogger({
    ownerUserId,
    sessionId: SESSION_ID,
    initialSeq,
  });
  console.log(`[cin-watch] runtime session ${SESSION_ID} owned by ${ownerUserId}.`);
  await loop(symbols, recordCycleLog);
}

void main().catch((err) => {
  console.error("[cin-watch] fatal", err);
  process.exit(1);
});
