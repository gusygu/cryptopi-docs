import { NextRequest, NextResponse } from "next/server";
import { runSystemRefresh } from "@/core/system/refresh";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const symbols = Array.isArray(body?.symbols) ? body.symbols : undefined;
    const interval = typeof body?.interval === "string" ? body.interval : undefined;
    const result = await runSystemRefresh({
      symbols,
      klinesInterval: interval,
      pollerId: body?.pollerId ?? "default",
    });
    return NextResponse.json({ ok: result.ok, result });
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, error: String(err?.message ?? err) },
      { status: 500 }
    );
  }
}

export async function GET(req: NextRequest) {
  const symbols = req.nextUrl.searchParams.get("symbols");
  const interval = req.nextUrl.searchParams.get("interval") ?? undefined;
  const selected = symbols
    ? symbols.split(",").map((s) => s.trim().toUpperCase()).filter(Boolean)
    : undefined;
  const result = await runSystemRefresh({
    symbols: selected,
    klinesInterval: interval,
    pollerId: "manual",
  });
  return NextResponse.json({ ok: result.ok, result });
}
