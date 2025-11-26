import { NextRequest, NextResponse } from "next/server";
import { db } from "@/core/db/db";
import { fetchTickersForCoins } from "@/core/sources/binance";
import { KNOWN_STABLE_QUOTES } from "@/core/features/cin-aux/runtimeQueries";

export async function POST(
  _req: NextRequest,
  { params }: { params: { sessionId: string } }
) {
  const sessionId = Number(params.sessionId);
  if (!Number.isFinite(sessionId)) {
    return NextResponse.json(
      { ok: false, error: "Invalid session id" },
      { status: 400 }
    );
  }

  try {
    const { rows } = await db.query<{ asset_id: string }>(
      `
        SELECT DISTINCT asset_id
          FROM cin_aux.rt_balance
         WHERE session_id = $1
      `,
      [sessionId]
    );

    const assets = rows
      .map((row) => String(row.asset_id || "").trim().toUpperCase())
      .filter((asset) => asset.length > 0);

    if (!assets.length) {
      return NextResponse.json({
        ok: true,
        marked: 0,
        note: "No assets to mark",
      });
    }

    const tradableRows = await db.query<{ asset: string }>(
      `
        SELECT DISTINCT UPPER(base_asset) AS asset
          FROM market.symbols
         WHERE status = 'TRADING'
           AND quote_asset = 'USDT'
      `,
    );
    const tradable = new Set<string>(
      tradableRows.rows.map((row) => String(row.asset || "").toUpperCase()),
    );
    for (const stable of KNOWN_STABLE_QUOTES) tradable.add(stable.toUpperCase());

    const fetchable = assets.filter((asset) => tradable.has(asset));

    const pricesMap = fetchable.length
      ? await fetchTickersForCoins(fetchable)
      : {};
    let marked = 0;

    for (const asset of assets) {
      let price: number | null = null;
      if (asset === "USDT") {
        price = 1;
      } else {
        price = pricesMap[asset]?.price ?? null;
      }
      if (price == null || !Number.isFinite(price) || price <= 0) continue;

      await db.query(
        `
          INSERT INTO cin_aux.rt_mark (session_id, asset_id, ts, price_usdt, bulk_usdt)
          VALUES ($1, $2, now(), $3, $3)
        `,
        [sessionId, asset, price]
      );
      marked += 1;
    }

    return NextResponse.json({
      ok: true,
      sessionId,
      marked,
    });
  } catch (err: any) {
    console.error("[prices/refresh]", err);
    return NextResponse.json(
      { ok: false, error: err?.message ?? "price refresh failed" },
      { status: 500 }
    );
  }
}
