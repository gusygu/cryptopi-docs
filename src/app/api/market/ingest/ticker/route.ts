// src/app/api/market/ingest/ticker/route.ts
import { NextResponse } from "next/server";
import { fetchCoinUniverseEntries } from "@/lib/settings/coin-universe";
import { ingestTickerSymbols } from "@/core/system/tasks";

const NO_STORE = { "Cache-Control": "no-store" };

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const symbols: string[] =
    body?.symbols ??
    (await fetchCoinUniverseEntries({ onlyEnabled: true })).map((entry) => entry.symbol);

  if (!symbols.length) {
    console.warn("[market/ticker] no symbols resolved from coin universe");
    return NextResponse.json({ ok: false, error: "no symbols resolved" }, { status: 400 });
  }

  const wrote = await ingestTickerSymbols(symbols);
  return NextResponse.json({ ok: true, wrote }, { headers: NO_STORE });
}
