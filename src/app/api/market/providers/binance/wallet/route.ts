import { NextResponse } from "next/server";
import { getBinanceWalletBalances } from "@/core/api/market/binance";
import { getCurrentUser } from "@/lib/auth/server";

export async function GET() {
  const user = await getCurrentUser();
  const email = user?.email?.toLowerCase();
  const snapshot = await getBinanceWalletBalances(email);
  return NextResponse.json(snapshot, { headers: { "Cache-Control": "no-store" } });
}
