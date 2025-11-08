import { NextResponse } from "next/server";
import { verifyBinanceAccount } from "./verify";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type ReqBody = { apiKey?: string; apiSecret?: string };

export async function POST(req: Request) {
  try {
    const { apiKey, apiSecret } = (await req.json()) as ReqBody;

    if (!apiKey || !apiSecret) {
      return NextResponse.json({ ok: false, error: "Missing apiKey or apiSecret" }, { status: 400 });
    }

    const result = await verifyBinanceAccount(apiKey, apiSecret);
    if (!result.ok) {
      return NextResponse.json(
        {
          ok: false,
          status: result.status ?? 0,
          error: result.error ?? "Request failed",
        },
        { status: 200 }
      );
    }

    return NextResponse.json({
      ok: true,
      accountType: result.accountType ?? null,
      canTrade: result.canTrade ?? false,
      balancesCount: result.balancesCount ?? 0,
      updateTime: result.updateTime ?? null,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err ?? "Unexpected error");
    return NextResponse.json({ ok: false, error: message }, { status: 200 });
  }
}
