import { NextRequest, NextResponse } from "next/server";
import { db } from "@/core/db/db";
import {
  KNOWN_STABLE_QUOTES,
  fetchUniverseBaseAssets,
} from "@/core/features/cin-aux/runtimeQueries";
import { fetchTickersForCoins } from "@/core/sources/binance";
import { getAccountBalances } from "@/core/sources/binanceAccount";
import { getCurrentUser } from "@/lib/auth/server";
import { getWallet } from "@/lib/wallet/registry";

type WalletRow = {
  assetId: string;
  units: number;
  priceUsdt: number | null;
  valueUsdt: number;
  inUniverse: boolean;
};

const STABLES = new Set(KNOWN_STABLE_QUOTES);

export async function POST(
  _req: NextRequest,
  ctx: { params: { sessionId: string } },
) {
  const sessionId = Number(ctx.params.sessionId);
  if (!Number.isFinite(sessionId)) {
    return NextResponse.json(
      { ok: false, error: "Invalid session id" },
      { status: 400 },
    );
  }

  try {
    const [user, sessionCheck] = await Promise.all([
      getCurrentUser(),
      db.query(
        `SELECT 1 FROM cin_aux.rt_session WHERE session_id = $1 LIMIT 1`,
        [sessionId],
      ),
    ]);

    if (!user) {
      return NextResponse.json(
        { ok: false, error: "Sign-in required to refresh the wallet." },
        { status: 401 },
      );
    }

    if (sessionCheck.rowCount === 0) {
      return NextResponse.json(
        { ok: false, error: "Session not found" },
        { status: 404 },
      );
    }

    const wallet = getWallet(user.email);
    const hasEnvCreds =
      Boolean(process.env.BINANCE_API_KEY) &&
      Boolean(process.env.BINANCE_API_SECRET);
    if (!wallet && !hasEnvCreds) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "Link a Binance API key in Settings before refreshing the wallet.",
        },
        { status: 412 },
      );
    }

    const email = wallet ? user.email.toLowerCase() : null;
    const [balancesMap, universe] = await Promise.all([
      getAccountBalances(email ? { email } : {}),
      fetchUniverseBaseAssets(),
    ]);

    const liveEntries = Object.entries(balancesMap ?? {})
      .map(([asset, amount]) => {
        const value = Number(amount);
        return {
          asset: asset.toUpperCase(),
          units: Number.isFinite(value) ? value : 0,
        };
      })
      .filter(({ asset, units }) => asset.length > 0 && units > 0);

    const hasBalances = liveEntries.length > 0;
    let priceMap: Record<string, { price: number; pct24h: number }> = {};
    if (hasBalances) {
      const dedupCoins = new Set<string>();
      for (const entry of liveEntries) {
        dedupCoins.add(entry.asset);
      }
      for (const coin of universe) {
        dedupCoins.add(coin);
      }
      if (dedupCoins.size > 0) {
        try {
          priceMap = await fetchTickersForCoins(Array.from(dedupCoins));
        } catch (err) {
          console.warn("[wallet/refresh] price fetch failed", err);
        }
      }
    }

    const walletRows: WalletRow[] = liveEntries.map(({ asset, units }) => {
      const upper = asset.toUpperCase();
      let price =
        upper === "USDT"
          ? 1
          : STABLES.has(upper)
          ? 1
          : priceMap[upper]?.price ?? null;
      if (price != null && (!Number.isFinite(price) || price <= 0)) {
        price = null;
      }
      const value = price != null ? units * price : 0;
      return {
        assetId: upper,
        units,
        priceUsdt: price,
        valueUsdt: value,
        inUniverse: universe.has(upper),
      };
    });

    walletRows.sort((a, b) => b.valueUsdt - a.valueUsdt);
    const totalUsdt = walletRows.reduce((acc, row) => acc + row.valueUsdt, 0);

    const client = await db.connect();
    try {
      await client.query("BEGIN");

      await client.query(
        `DELETE FROM cin_aux.rt_balance WHERE session_id = $1`,
        [sessionId],
      );

      if (walletRows.length) {
        const balanceValues: any[] = [];
        const placeholders = walletRows
          .map((row, idx) => {
            const offset = idx * 6;
            balanceValues.push(
              sessionId,
              row.assetId,
              row.valueUsdt,
              0,
              row.valueUsdt,
              0,
            );
            return `($${offset + 1}, $${offset + 2}, $${offset + 3}, $${
              offset + 4
            }, $${offset + 5}, $${offset + 6})`;
          })
          .join(",");
        await client.query(
          `
            INSERT INTO cin_aux.rt_balance (
              session_id,
              asset_id,
              opening_principal,
              opening_profit,
              principal_usdt,
              profit_usdt
            )
            VALUES ${placeholders}
            ON CONFLICT (session_id, asset_id)
            DO UPDATE SET
              opening_principal = EXCLUDED.opening_principal,
              opening_profit    = EXCLUDED.opening_profit,
              principal_usdt    = EXCLUDED.principal_usdt,
              profit_usdt       = EXCLUDED.profit_usdt
          `,
          balanceValues,
        );
      }

      await client.query(
        `DELETE FROM cin_aux.rt_reference WHERE session_id = $1`,
        [sessionId],
      );

      if (walletRows.length) {
        const refValues: any[] = [];
        const refPlaceholders = walletRows
          .map((row, idx) => {
            const offset = idx * 4;
            refValues.push(
              sessionId,
              row.assetId,
              row.valueUsdt,
              "wallet.refresh",
            );
            return `($${offset + 1}, $${offset + 2}, $${offset + 3}, now(), $${
              offset + 4
            })`;
          })
          .join(",");
        await client.query(
          `
            INSERT INTO cin_aux.rt_reference (
              session_id,
              asset_id,
              ref_usdt,
              computed_at,
              source_tag
            )
            VALUES ${refPlaceholders}
            ON CONFLICT (session_id, asset_id)
            DO UPDATE SET
              ref_usdt    = EXCLUDED.ref_usdt,
              computed_at = EXCLUDED.computed_at,
              source_tag  = EXCLUDED.source_tag
          `,
          refValues,
        );
      }

      await client.query(
        `
          INSERT INTO cin_aux.rt_imprint_luggage (
            session_id,
            imprint_principal_churn_usdt,
            imprint_profit_churn_usdt,
            imprint_generated_profit_usdt,
            imprint_trace_sum_usdt,
            imprint_devref_sum_usdt,
            luggage_total_principal_usdt,
            luggage_total_profit_usdt
          )
          VALUES ($1,0,0,0,0,0,$2,0)
          ON CONFLICT (session_id)
          DO UPDATE SET
            luggage_total_principal_usdt = EXCLUDED.luggage_total_principal_usdt,
            luggage_total_profit_usdt = EXCLUDED.luggage_total_profit_usdt
        `,
        [sessionId, totalUsdt],
      );

      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }

    return NextResponse.json({
      ok: true,
      sessionId,
      assets: walletRows,
      totalUsdt,
      note: hasBalances
        ? undefined
        : "No wallet balances detected for the linked Binance account.",
    });
  } catch (e: any) {
    console.error("[wallet/refresh]", e);
    return NextResponse.json(
      { ok: false, error: e?.message ?? "wallet refresh failed" },
      { status: 500 },
    );
  }
}
