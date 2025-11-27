import { NextRequest, NextResponse } from "next/server";
import { db } from "@/core/db/db";
import { getSettingsCoins } from "@/core/sources/binance";
import {
  getMyTradesForSymbol,
  getConvertTradeFlow,
  type AccountTrade,
} from "@/core/sources/binanceAccount";
import { getCurrentUser } from "@/lib/auth/server";
import { getWallet } from "@/lib/wallet/registry";
import {
  normalizeAccountScope,
  insertAccountTrade,
  insertConvertTrade,
  getLastConvertTradeMs,
  primeAssetPriceCache,
} from "@/scripts/jobs/lib/cinTradeIngest";
import { isWeightLimitError } from "@/scripts/jobs/lib/binanceRateLimit";
import {
  ensureProfileEmailRow,
  backfillAccountTradesEmail,
} from "@/core/features/cin-aux/accountScope";

const DEFAULT_LOOKBACK_DAYS = 30; // first sync safety window
const CONVERT_LOOKBACK_DAYS = Math.max(
  1,
  Number(process.env.CIN_API_CONVERT_LOOKBACK_DAYS ?? DEFAULT_LOOKBACK_DAYS),
);
const CONVERT_LIMIT = Math.min(
  1000,
  Number(process.env.CIN_API_CONVERT_LIMIT ?? 500),
);
const HAS_ENV_BINANCE_CREDS =
  Boolean(process.env.BINANCE_API_KEY) &&
  Boolean(process.env.BINANCE_API_SECRET);

export async function POST(
  req: NextRequest,
  { params }: { params: { sessionId: string } }
) {
  try {
    const body = (await req.json().catch(() => ({}))) as {
      sessionId?: string | number | null;
    };

    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json(
        { ok: false, error: "Sign-in required to sync trades." },
        { status: 401 },
      );
    }

    const wallet = getWallet(user.email);
    if (!wallet && !HAS_ENV_BINANCE_CREDS) {
      return NextResponse.json(
        {
          ok: false,
          error: "Link a Binance API key in Settings before syncing trades.",
        },
        { status: 412 },
      );
    }

    const accountEmail = user.email?.toLowerCase().trim() ?? null;
    if (accountEmail) {
      await ensureProfileEmailRow(accountEmail, user.nickname ?? null);
      await backfillAccountTradesEmail(accountEmail);
    }
    const accountScope = normalizeAccountScope(accountEmail);
    const sessionId = body.sessionId ?? params.sessionId ?? null;

    // 1) Which symbols to scan? Take every TRADING pair whose base OR quote
    // belongs to the configured coin universe.
    const coins = await getSettingsCoins(); // e.g. ["BTC","ETH","SOL","ADA","USDT",...]

    const symRows = await db.query<{ symbol: string }>(
      `select symbol
         from market.symbols
        where status = 'TRADING'
          and (base_asset = any($1) or quote_asset = any($1))`,
      [coins],
    );

    const symbols = [...new Set(symRows.rows.map((r) => r.symbol))].sort();

    let totalImported = 0;
    const perSymbol: Record<string, number> = {};

    for (const symbol of symbols) {
      // 2) Cursor: last known trade_id for this symbol
      const maxRows = await db.query<{ max_id: string | null }>(
        `select max(trade_id) as max_id
           from market.account_trades
          where symbol = $1
            and (account_email is not distinct from $2)`,
        [symbol, accountEmail],
      );
      const maxIdStr = maxRows.rows[0]?.max_id;
      const lastTradeId = maxIdStr != null ? BigInt(maxIdStr) : null;

      const fromId =
        lastTradeId != null ? Number(lastTradeId + 1n) : undefined;

      // First sync? Look back a bit in time but don’t fetch all history
      const startTime =
        lastTradeId == null
          ? Date.now() - DEFAULT_LOOKBACK_DAYS * 24 * 60 * 60 * 1000
          : undefined;

      // 3) Fetch trades from Binance
      const trades: AccountTrade[] = await getMyTradesForSymbol(symbol, {
        email: accountEmail || undefined,
        fromId,
        startTime,
      });

      if (!trades.length) {
        perSymbol[symbol] = 0;
        continue;
      }

      // 4) Insert trades idempotently
      let importedForSymbol = 0;

      for (const t of trades) {
        const stored = await insertAccountTrade(symbol, t, accountScope);
        if (stored) {
          importedForSymbol++;
          totalImported++;
        }
      }

      perSymbol[symbol] = importedForSymbol;
    }

    // Convert trades (BINANCE Convert tradeFlow)
    const now = Date.now();
    const lastConvertMs = await getLastConvertTradeMs(accountScope);
    const startConvertMs =
      lastConvertMs != null
        ? Math.min(lastConvertMs + 1, now)
        : now - CONVERT_LOOKBACK_DAYS * 24 * 60 * 60 * 1000;
    const convertTrades = await getConvertTradeFlow({
      email: accountEmail || undefined,
      startTime: startConvertMs,
      endTime: now,
      limit: CONVERT_LIMIT,
    });
    convertTrades.sort((a, b) => Number(a.createTime) - Number(b.createTime));

    const assetsToPrime = new Set<string>();
    for (const entry of convertTrades) {
      const base = String(entry.toAsset ?? "").trim().toUpperCase();
      const quote = String(entry.fromAsset ?? "").trim().toUpperCase();
      if (base && base !== "USDT") assetsToPrime.add(base);
      if (quote && quote !== "USDT") assetsToPrime.add(quote);
    }
    if (assetsToPrime.size) {
      await primeAssetPriceCache(Array.from(assetsToPrime));
    }

    let importedConvert = 0;
    for (const entry of convertTrades) {
      if (await insertConvertTrade(entry, accountScope)) {
        importedConvert += 1;
      }
    }

    return NextResponse.json({
      ok: true,
      sessionId,
      importedTrades: totalImported,
      importedConvert,
      perSymbol,
    });
  } catch (e: any) {
    if (isWeightLimitError(e)) {
      console.warn("[api/trades/sync] weight limit hit:", e?.message ?? e);
      return NextResponse.json(
        {
          ok: false,
          error:
            e?.message ??
            "Binance request weight exceeded. Please wait a minute before retrying.",
        },
        { status: 429 },
      );
    }
    console.error("[api/trades/sync] error", e);
    return NextResponse.json(
      { ok: false, error: e?.message ?? String(e) },
      { status: 500 },
    );
  }
}
