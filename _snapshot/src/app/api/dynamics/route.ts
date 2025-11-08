import { NextRequest, NextResponse } from "next/server";
import "@/app/(server)/wire-converter";
import { buildDynamicsSnapshot } from "@/core/converters/Converter.server";

const ensureUpper = (value: string | null | undefined) => String(value ?? "").trim().toUpperCase();

const parseCsv = (value: string | null | undefined) => {
  if (!value) return [];
  return value
    .split(",")
    .map((s) => ensureUpper(s))
    .filter(Boolean);
};

const dedupe = (values: string[]) => Array.from(new Set(values));

const defaultCoins = () =>
  (process.env.NEXT_PUBLIC_COINS ?? "BTC,ETH,BNB,SOL,ADA,XRP,USDT")
    .split(",")
    .map((s) => ensureUpper(s))
    .filter(Boolean);

export async function GET(req: NextRequest) {
  const url = req.nextUrl;
  const base = ensureUpper(url.searchParams.get("base") ?? url.searchParams.get("Ca"));
  const quote = ensureUpper(url.searchParams.get("quote") ?? url.searchParams.get("Cb"));

  if (!base || !quote) {
    return NextResponse.json(
      { ok: false, error: "missing_base_or_quote" },
      { status: 400, headers: { "Cache-Control": "no-store" } }
    );
  }

  const coinsParam = parseCsv(url.searchParams.get("coins"));
  const coins = dedupe(coinsParam.length ? coinsParam : defaultCoins());

  const candidatesParam = parseCsv(url.searchParams.get("candidates"));
  const candidates = dedupe(
    candidatesParam.length ? candidatesParam : coins.filter((c) => c !== base && c !== quote)
  );

  const histLen = Number(url.searchParams.get("histLen"));
  const bins = Number(url.searchParams.get("bins"));

  try {
    const snapshot = await buildDynamicsSnapshot({
      base,
      quote,
      Ca: base,
      Cb: quote,
      coinsUniverse: coins,
      candidates,
      histLen: Number.isFinite(histLen) ? histLen : undefined,
      histogramBins: Number.isFinite(bins) ? bins : undefined,
    });

    return NextResponse.json(
      { ok: true, snapshot },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, error: err?.message ?? String(err) },
      { status: 500, headers: { "Cache-Control": "no-store" } }
    );
  }
}
