import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { resolveSymbolSelection } from "@/core/features/str-aux/symbols";

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const selection = await resolveSymbolSelection(url);

    return NextResponse.json({
      ok: true,
      ts: Date.now(),
      source: selection.source,
      quote: selection.quote,
      quotes: selection.quotes,
      bases: selection.bases,
      defaults: selection.defaults,
      extras: selection.extras,
      explicit: selection.explicit,
      symbols: selection.symbols,
    });
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, error: String(err?.message ?? err) },
      { status: 500 }
    );
  }
}

