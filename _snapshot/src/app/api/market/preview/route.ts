import { NextResponse } from "next/server";
import { getBinancePreviewCoins } from "@/core/api/market/binance";

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

const sanitizeQuote = (value: string | null): string | null => {
  const normalized = toUpper(value);
  if (!normalized || normalized === "ALL" || normalized === "ANY") return null;
  const alnum = normalized.replace(/[^A-Z0-9]/g, "");
  return alnum || null;
};

export async function GET(req: Request) {
  const url = new URL(req.url);
  const quote = sanitizeQuote(url.searchParams.get("quote"));
  const spotOnly = parseSpotOnly(url.searchParams.get("spotOnly"));

  const { coins, cached, updatedAt, note } = await getBinancePreviewCoins({
    quote: quote ?? undefined,
    spotOnly,
  });

  return NextResponse.json(
    {
      ok: true,
      quote,
      coins,
      cached,
      updatedAt,
      note,
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}
