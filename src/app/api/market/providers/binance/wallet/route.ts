import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getBinanceWalletBalances } from "@/core/api/market/binance";

export async function GET() {
  const jar = await cookies();
  const raw = jar.get("session")?.value ?? "";
  const email = raw.split("|")[0]?.trim().toLowerCase() || undefined;
  const snapshot = await getBinanceWalletBalances(email);
  return NextResponse.json(snapshot, { headers: { "Cache-Control": "no-store" } });
}
