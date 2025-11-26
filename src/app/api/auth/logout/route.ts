import { NextResponse } from "next/server";
import { clearSessionCookieAndRevoke } from "@/lib/auth/server";

export async function POST() {
  await clearSessionCookieAndRevoke();
  return NextResponse.json({ ok: true });
}
