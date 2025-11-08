// src/app/api/str-aux/symbols/route.ts
import { NextRequest, NextResponse } from "next/server";
import { fetch24hAll, listSymbolsByQuote } from "@/core/sources/binance";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const quote = (searchParams.get("quote") ?? "USDT").toUpperCase().trim();

    // fetch symbol universe from exchangeInfo
    const symbols = await listSymbolsByQuote(quote);
    if (!symbols.length) {
      return NextResponse.json({ ok: false, error: "No symbols for quote" }, { status: 404 });
    }

    // optional: warm data / validate by fetching 24h (can be skipped if heavy)
    await fetch24hAll(symbols, quote);

    return NextResponse.json({ ok: true, quote, symbols });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message ?? "error" }, { status: 500 });
  }
}
