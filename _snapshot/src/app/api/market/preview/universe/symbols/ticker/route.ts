import { NextResponse } from "next/server";
import {
  resolvePreviewUniverseSnapshot,
  type PreviewUniverseOptions,
} from "../../shared";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const toUpper = (value: string | null | undefined) =>
  String(value ?? "").trim().toUpperCase();

const parseSpotOnly = (value: string | null): boolean => {
  if (value === null || value === undefined) return true;
  const normalized = toUpper(value);
  if (!normalized) return true;
  if (normalized === "0" || normalized === "FALSE" || normalized === "NO") {
    return false;
  }
  return true;
};

type TickerRow = Record<string, unknown> & { symbol?: string };

async function fetchTickerSnapshots(symbols: string[]): Promise<Record<string, TickerRow>> {
  const map = new Map<string, TickerRow>();
  const chunkSize = 120;

  for (let i = 0; i < symbols.length; i += chunkSize) {
    const chunk = symbols.slice(i, i + chunkSize);
    if (!chunk.length) continue;
    try {
      const url = `https://api.binance.com/api/v3/ticker/24hr?symbols=${encodeURIComponent(
        JSON.stringify(chunk)
      )}`;
      const response = await fetch(url, { cache: "no-store" });
      if (!response.ok) continue;
      const payload = (await response.json()) as TickerRow[];
      for (const row of payload ?? []) {
        const symbol = toUpper(row?.symbol);
        if (!symbol) continue;
        if (!map.has(symbol)) {
          map.set(symbol, row);
        }
      }
      // small delay to stay friendly with the public API
      if (symbols.length > chunkSize) {
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
    } catch {
      // ignore failing chunk, continue attempting remaining symbols
    }
  }

  return Object.fromEntries(map);
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const options: PreviewUniverseOptions = {
    quote: url.searchParams.get("quote"),
    spotOnly: parseSpotOnly(url.searchParams.get("spotOnly")),
  };

  const snapshot = await resolvePreviewUniverseSnapshot(options);
  const symbols = snapshot.symbols;

  const ticker =
    symbols.length > 0 ? await fetchTickerSnapshots(symbols) : {};

  return NextResponse.json(
    {
      ok: true,
      quote: snapshot.quote,
      coins: snapshot.coins,
      symbols,
      ticker,
      cached: snapshot.cached,
      updatedAt: snapshot.updatedAt,
      note: snapshot.note,
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}
