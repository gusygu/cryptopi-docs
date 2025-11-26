import { NextResponse } from "next/server";
import { fetchCinSessions } from "@/core/features/cin-aux/session";

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const rawLimit = url.searchParams.get("limit");
    const parsed = rawLimit ? Number(rawLimit) : NaN;
    const limit = Number.isFinite(parsed) ? Math.floor(parsed) : undefined;
    const data = await fetchCinSessions({ limit });
    return NextResponse.json({ ok: true, ...data });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unable to fetch sessions";
    console.error("cin-aux session/list error:", err);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
