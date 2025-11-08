import { NextResponse } from "next/server";
import { getBinancePreviewCoins } from "@/core/api/market/binance";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const toUpper = (value: string | null | undefined) =>
  String(value ?? "").trim().toUpperCase();

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
  if (legacy !== null) {
    return parseSpotOnlyParam(legacy);
  }
  return parseSpotOnlyParam(url.searchParams.get("spotOnly"));
};

const sanitizeQuote = (value: string | null): string | null => {
  const normalized = toUpper(value);
  if (!normalized || normalized === "ALL" || normalized === "ANY") return null;
  const alnum = normalized.replace(/[^A-Z0-9]/g, "");
  return alnum || null;
};

export async function GET(req: Request) {
  const url = new URL(req.url);
  const quote = sanitizeQuote(url.searchParams.get("quote"));
  const spotOnly = resolveSpotOnly(url);

  try {
    const payload = await getBinancePreviewCoins({
      quote: quote ?? undefined,
      spotOnly,
    });

    return NextResponse.json(
      {
        ok: true,
        source: "binance",
        quote,
        coins: payload.coins,
        symbols: payload.symbols,
        count: payload.coins.length,
        cached: payload.cached,
        updatedAt: payload.updatedAt,
        note: payload.note,
      },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "preview fetch failed";
    return NextResponse.json(
      {
        ok: false,
        source: "binance",
        quote,
        coins: [] as string[],
        symbols: [] as string[],
        count: 0,
        error: message,
      },
      { status: 502, headers: { "Cache-Control": "no-store" } }
    );
  }
}
