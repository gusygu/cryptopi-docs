import { NextRequest, NextResponse } from "next/server";
import { db } from "@/core/db/db";
import { getSettingsCoins } from "@/core/sources/binance";
import {
  getMyTradesForSymbol,
  type AccountTrade,
} from "@/core/sources/binanceAccount";
import { getCurrentUser } from "@/lib/auth/server";
import { getWallet } from "@/lib/wallet/registry";

const DEFAULT_LOOKBACK_DAYS = 30; // first sync safety window
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

    const accountEmail = wallet ? user.email.toLowerCase().trim() : null;
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
        const tradeTime = new Date(t.time); // ms → JS Date

        const res = await db.query(
          `insert into market.account_trades (
             symbol,
             trade_id,
             order_id,
             price,
             qty,
             quote_qty,
             commission,
             commission_asset,
             trade_time,
             is_buyer,
             is_maker,
             is_best_match,
             account_email,
             raw
           )
           values (
             $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14
           )
           on conflict (symbol, trade_id) do nothing
           returning trade_id`,
          [
            symbol,
            t.id,
            t.orderId,
            t.price,
            t.qty,
            t.quoteQty,
            t.commission,
            t.commissionAsset,
            tradeTime,
            t.isBuyer,
            t.isMaker,
            t.isBestMatch,
            accountEmail,
            JSON.stringify(t),
          ],
        );

        if (res.rowCount && res.rowCount > 0) {
          importedForSymbol++;
          totalImported++;
        }
      }

      perSymbol[symbol] = importedForSymbol;
    }

    return NextResponse.json({
      ok: true,
      sessionId,
      importedTrades: totalImported,
      perSymbol,
    });
  } catch (e: any) {
    console.error("[api/trades/sync] error", e);
    return NextResponse.json(
      { ok: false, error: e?.message ?? String(e) },
      { status: 500 },
    );
  }
}
