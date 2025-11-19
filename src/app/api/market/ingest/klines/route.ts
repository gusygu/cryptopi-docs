// src/app/api/market/ingest/klines/route.ts
import { NextResponse } from "next/server";
import { fetchCoinUniverseEntries } from "@/lib/settings/coin-universe";
import { ingestKlinesSymbols } from "@/core/system/tasks";

const NO_STORE = { "Cache-Control": "no-store" };

export async function POST(req: Request) {
  const { interval = "30m", symbols: bodySyms } = await req.json().catch(() => ({}));
  const symbols: string[] =
    bodySyms ??
    (await fetchCoinUniverseEntries({ onlyEnabled: true })).map((entry) => entry.symbol);

  if (!symbols.length) {
    console.warn("[market/klines] no symbols resolved from coin universe");
    return NextResponse.json({ ok: false, error: "no symbols resolved" }, { status: 400 });
  }

  const rows = await ingestKlinesSymbols(symbols, interval, 200);
  return NextResponse.json({ ok: true, interval, wrote: rows }, { headers: NO_STORE });
}
