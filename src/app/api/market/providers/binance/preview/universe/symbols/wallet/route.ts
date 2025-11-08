import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import {
  resolvePreviewUniverseSnapshot,
  type PreviewUniverseOptions,
} from "../../../../../../preview/universe/shared";
import { getBinanceWalletBalances } from "@/core/api/market/binance";

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

const resolveSpotOnly = (url: URL): boolean => {
  const legacy = url.searchParams.get("spot");
  if (legacy !== null) return parseSpotOnly(legacy);
  return parseSpotOnly(url.searchParams.get("spotOnly"));
};

const WALLET_DISABLED_RESPONSE = NextResponse.json(
  { ok: false, error: "wallet feature disabled" },
  { status: 403, headers: { "Cache-Control": "no-store" } }
);

function extractEmail(sessionValue: string | undefined): string | undefined {
  if (!sessionValue) return undefined;
  const [first] = sessionValue.split("|");
  const email = (first ?? "").trim().toLowerCase();
  return email || undefined;
}

export async function GET(req: Request) {
  if (process.env.WALLET_ENABLED !== "true") {
    return WALLET_DISABLED_RESPONSE;
  }

  const url = new URL(req.url);
  const options: PreviewUniverseOptions = {
    quote: url.searchParams.get("quote"),
    spotOnly: resolveSpotOnly(url),
  };

  const snapshot = await resolvePreviewUniverseSnapshot(options);
  const assets = new Set(snapshot.coins.map(toUpper));

  const jar = await cookies();
  const sessionValue = jar.get("session")?.value;
  const email = extractEmail(sessionValue);
  const walletSnapshot = await getBinanceWalletBalances(email);

  const filteredWallets: Record<string, number> = {};
  for (const [asset, balance] of Object.entries(walletSnapshot.wallets ?? {})) {
    const key = toUpper(asset);
    if (!key || !assets.has(key)) continue;
    const numeric = Number(balance);
    if (!Number.isFinite(numeric)) continue;
    filteredWallets[key] = numeric;
  }

  return NextResponse.json(
    {
      ok: true,
      source: "binance",
      quote: snapshot.quote,
      coins: snapshot.coins,
      symbols: snapshot.symbols,
      wallet: {
        provider: walletSnapshot.provider,
        assets: filteredWallets,
        warn: walletSnapshot.warn,
      },
      cached: snapshot.cached,
      updatedAt: snapshot.updatedAt,
      note: snapshot.note,
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}
