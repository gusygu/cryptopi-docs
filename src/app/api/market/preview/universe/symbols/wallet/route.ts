import { NextResponse } from "next/server";
import {
  resolvePreviewUniverseSnapshot,
  type PreviewUniverseOptions,
} from "../../shared";
import { getBinanceWalletBalances } from "@/core/api/market/binance";
import { getCurrentUser } from "@/lib/auth/server";

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

const WALLET_DISABLED_RESPONSE = NextResponse.json(
  { ok: false, error: "wallet feature disabled" },
  { status: 403, headers: { "Cache-Control": "no-store" } }
);

export async function GET(req: Request) {
  if (process.env.WALLET_ENABLED !== "true") {
    return WALLET_DISABLED_RESPONSE;
  }

  const url = new URL(req.url);
  const options: PreviewUniverseOptions = {
    quote: url.searchParams.get("quote"),
    spotOnly: parseSpotOnly(url.searchParams.get("spotOnly")),
  };

  const snapshot = await resolvePreviewUniverseSnapshot(options);
  const assets = new Set(snapshot.coins.map(toUpper));

  const user = await getCurrentUser();
  const email = user?.email?.toLowerCase();
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
