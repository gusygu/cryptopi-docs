// src/app/api/market/ingest/ticker/route.ts
import { NextResponse } from "next/server";
import { db } from "@/core/db/server";

const NO_STORE = { "Cache-Control": "no-store" };

async function fetchTickerPrice(symbol: string) {
  const res = await fetch(
    `https://api.binance.com/api/v3/ticker/price?symbol=${encodeURIComponent(symbol)}`,
    { cache: "no-store" }
  );
  if (!res.ok) throw new Error(`ticker ${symbol}: ${res.status}`);
  return res.json() as Promise<{ symbol: string; price: string }>;
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  // If the client doesn’t pass symbols, use the UI-enabled universe from DB
  const symbols: string[] =
    body?.symbols ??
    (
      await db.query<{ symbol: string }>(
        `select symbol from settings.coin_universe where enabled = true`
      )
    ).rows.map(r => r.symbol);

  // Pull + upsert
  for (const s of symbols) {
    const payload = await fetchTickerPrice(s);
    await db.query(`select market.apply_ticker_from_payload($1,$2::jsonb)`, [
      s,
      JSON.stringify(payload),
    ]);
  }

  // Read back the current latest
  const { rows: latest } = await db.query(
    `select symbol, ts, price, meta from market.ticker_latest
     where symbol = any($1::text[]) order by symbol`,
    [symbols]
  );

  return NextResponse.json({ ok: true, wrote: symbols.length, latest }, { headers: NO_STORE });
}
