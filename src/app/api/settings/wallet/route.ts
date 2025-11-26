import { NextResponse } from "next/server";
import { verifyBinanceAccount } from "@/app/api/market/providers/binance/account/test/verify";
import { clearWalletCache } from "@/core/sources/binanceAccount";
import { deleteWallet, getWallet, maskKey, setWallet } from "@/lib/wallet/registry";
import { getCurrentUser } from "@/lib/auth/server";

export const dynamic = "force-dynamic";
export const revalidate = 0;

async function readSessionEmail(): Promise<string | null> {
  const user = await getCurrentUser();
  return user?.email?.toLowerCase() ?? null;
}

export async function GET() {
  const email = await readSessionEmail();
  if (!email) {
    return NextResponse.json({ ok: false, error: "Not signed in" }, { status: 401 });
  }

  const wallet = getWallet(email);
  if (!wallet) {
    return NextResponse.json({ ok: true, email, linked: false }, { headers: { "Cache-Control": "no-store" } });
  }

  return NextResponse.json(
    {
      ok: true,
      email,
      linked: true,
      keyId: wallet.apiKey,
      keyHint: maskKey(wallet.apiKey),
      linkedAt: new Date(wallet.linkedAt).toISOString(),
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}

type WalletPayload = { apiKey?: string; apiSecret?: string };

export async function POST(req: Request) {
  const email = await readSessionEmail();
  if (!email) {
    return NextResponse.json({ ok: false, error: "Not signed in" }, { status: 401 });
  }

  const { apiKey, apiSecret } = (await req.json()) as WalletPayload;
  if (!apiKey || !apiSecret) {
    return NextResponse.json({ ok: false, error: "Missing apiKey or apiSecret" }, { status: 400 });
  }

  const result = await verifyBinanceAccount(apiKey, apiSecret);
  if (!result.ok) {
    return NextResponse.json(
      { ok: false, error: result.error ?? "Verification failed", status: result.status ?? 0 },
      { status: 200 }
    );
  }

  const record = setWallet(email, { apiKey, apiSecret, linkedAt: Date.now() });
  clearWalletCache(email);

  return NextResponse.json(
    {
      ok: true,
      email,
      linked: true,
      keyId: record.apiKey,
      keyHint: maskKey(record.apiKey),
      linkedAt: new Date(record.linkedAt).toISOString(),
      account: {
        accountType: result.accountType ?? null,
        canTrade: result.canTrade ?? false,
        balancesCount: result.balancesCount ?? 0,
        updateTime: result.updateTime ?? null,
      },
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}

export async function DELETE() {
  const email = await readSessionEmail();
  if (!email) {
    return NextResponse.json({ ok: false, error: "Not signed in" }, { status: 401 });
  }

  deleteWallet(email);
  clearWalletCache(email);

  return NextResponse.json({ ok: true, email, linked: false }, { headers: { "Cache-Control": "no-store" } });
}
