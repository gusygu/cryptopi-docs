import { getCurrentSession } from "@/app/(server)/auth/session";
import { NextResponse } from "next/server";

export async function requireAdmin() {
  const session = await getCurrentSession();
  if (!session || !session.isAdmin) {
    return {
      ok: false as const,
      response: NextResponse.json(
        { ok: false, error: "forbidden" },
        { status: 403 }
      ),
      session: null,
    };
  }
  return {
    ok: true as const,
    response: null,
    session,
  };
}
