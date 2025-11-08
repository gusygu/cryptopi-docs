import { NextResponse } from "next/server";
import { getBinancePreviewSymbols } from "@/core/api/market/binance";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const toUpper = (value: string | null | undefined) =>
  String(value ?? "").trim().toUpperCase();

const sanitizeQuote = (value: string | null): string | null => {
  const normalized = toUpper(value);
  if (!normalized || normalized === "ALL" || normalized === "ANY") return null;
  const alnum = normalized.replace(/[^A-Z0-9]/g, "");
  return alnum || null;
};

const parseSpotOnlyParam = (value: string | null): boolean => {
  if (value === null || value === undefined) return true;
  const normalized = toUpper(value);
  if (!normalized) return true;
  if (normalized === "0" || normalized === "FALSE" || normalized === "NO") {
    return false;
  }
  return true;
};

const resolveSpotOnly = (url: URL): boolean => {
  const legacy = url.searchParams.get("spot");
  if (legacy !== null) return parseSpotOnlyParam(legacy);
  return parseSpotOnlyParam(url.searchParams.get("spotOnly"));
};

const parseCoinsParam = (value: string | null): string[] => {
  if (!value) return [];
  const tokens = value
    .split(/[,\s]+/)
    .map(toUpper)
    .map((token) => token.replace(/[^A-Z0-9]/g, ""))
    .filter(Boolean);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const token of tokens) {
    if (seen.has(token)) continue;
    seen.add(token);
    out.push(token);
  }
  return out;
};

const filterByCoins = (
  symbols: string[],
  coins: string[],
  quote: string | null
) => {
  if (!coins.length) return symbols;
  const set = new Set(coins);
  if (!quote) {
    return symbols.filter((symbol) => {
      const upper = toUpper(symbol);
      if (!upper) return false;
      for (const coin of set) {
        if (upper.startsWith(coin)) return true;
      }
      return false;
    });
  }
  const qLen = quote.length;
  return symbols.filter((symbol) => {
    const upper = toUpper(symbol);
    if (!upper || !upper.endsWith(quote) || upper.length <= qLen) return false;
    const base = upper.slice(0, upper.length - qLen);
    return set.has(base);
  });
};

export async function GET(req: Request) {
  const url = new URL(req.url);
  const quote = sanitizeQuote(url.searchParams.get("quote"));
  const spotOnly = resolveSpotOnly(url);
  const filterCoins = parseCoinsParam(url.searchParams.get("coins"));

  const { symbols, cached, updatedAt, note } = await getBinancePreviewSymbols({
    quote: quote ?? undefined,
    spotOnly,
  });

  const filtered = filterByCoins(symbols, filterCoins, quote);

  return NextResponse.json(
    {
      ok: true,
      source: "binance",
      quote,
      symbols: filtered,
      cached,
      updatedAt,
      note,
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}
