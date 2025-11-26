import { NextResponse } from "next/server";
import { getCurrentSession } from "@/app/(server)/auth/session";

export async function GET() {
  const session = await getCurrentSession();

  return NextResponse.json({
    ok: !!session,
    email: session?.email ?? null,
    nickname: session?.nickname ?? null,
    isAdmin: session?.isAdmin ?? false,
  });
}
