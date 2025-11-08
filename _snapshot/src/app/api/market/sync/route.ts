// src/app/api/market/sync/route.ts
import { NextResponse } from "next/server";
import { db } from "@/core/db/server";

export async function POST() {
  // if you have settings.sp_sync_coin_universe() being called from your Settings UI already,
  // this route just mirrors that into the market catalog.
  const { rows } = await db.query<{ upserted: number; disabled: number }>(
    `select * from market.sp_sync_from_settings_universe()`
  );
  return NextResponse.json({ ok: true, result: rows[0] ?? null }, { headers: { "Cache-Control": "no-store" } });
}
