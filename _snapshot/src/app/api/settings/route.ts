// src/app/api/settings/route.ts
import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";                 // ✅ use cookies() here
import { getAll, serializeSettingsCookie } from "@/lib/settings/server";
import { query } from "@/core/db/pool_server";

const NO_STORE = { "Cache-Control": "no-store" };

export async function GET(req: NextRequest) {
  const debug = req.nextUrl.searchParams.get("debug") === "1";
  const settings = await getAll();
  const shared = {
    settings,
    coinUniverse: settings.coinUniverse,
    coins: settings.coinUniverse,
  };

  if (!debug) {
    return NextResponse.json(shared, { headers: NO_STORE });
  }

  // ✅ this was the bug: use cookies() (request-scoped) to read the cookie value
  const jar = await cookies();
  const rawCookie = jar.get("appSettings")?.value ?? null;

  return NextResponse.json({ ...shared, __debug: { rawCookie } }, { headers: NO_STORE });
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const incoming = body?.settings ?? {};
    const { settings, cookie } = await serializeSettingsCookie(incoming);
    const res = NextResponse.json({ ok: true, settings });
    res.cookies.set(cookie.name, cookie.value, cookie.options);
    return res;
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: String(err?.message ?? err) }, { status: 400 });
  }
}

export async function PUT(req: Request) {
  const body = await req.json();
  const enable = Array.isArray(body.enable) ? body.enable : [];
  const disable = Array.isArray(body.disable) ? body.disable : [];

  // 1️⃣ Ensure market has the new ones
  if (enable.length)
    await query(`insert into market.symbols(symbol)
                 select s from unnest($1::text[]) s
                 on conflict do nothing`, [enable]);

  // 2️⃣ Upsert enable / disable in settings
  if (enable.length)
    await query(`insert into settings.coin_universe(symbol, enabled)
                 select s, true from unnest($1::text[]) s
                 on conflict (symbol) do update set enabled = true`, [enable]);
  if (disable.length)
    await query(`update settings.coin_universe
                    set enabled = false
                  where symbol = any($1::text[])`, [disable]);

  // 3️⃣ Auto-sync remaining market symbols
  await query(`select settings.sync_coin_universe(true, 'USDT')`);

  return new Response(JSON.stringify({ ok: true }), { status: 200 });
}
