// src/app/api/db/health/route.ts
import { NextResponse } from "next/server";
import { getPool } from "legacy/pool";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET() {
  try {
    const pool = getPool();
    const r = await pool.query("SELECT now()");
    return NextResponse.json({
      ok: true,
      db: "up",
      now: r.rows?.[0]?.now ?? null,
    });
  } catch (e: any) {
    // do not 500 — return ok:false so client UI never “ghosts”
    return NextResponse.json({ ok: false, db: "down", error: String(e?.message ?? e) });
  }
}
