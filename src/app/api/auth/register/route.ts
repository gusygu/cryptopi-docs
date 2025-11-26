import { NextRequest, NextResponse } from "next/server";
import { createUserFromInvite, createSession } from "@/lib/auth/server";

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));

  const email = String(body.email || "").trim().toLowerCase();
  const nickname = String(body.nickname || "").trim();
  const password = String(body.password || "");
  const inviteToken = String(body.inviteToken || "");

  if (!email || !password || !inviteToken) {
    return NextResponse.json(
      { ok: false, error: "email, password and inviteToken are required" },
      { status: 400 },
    );
  }

  try {
    const user = await createUserFromInvite({
      email,
      nickname,
      password,
      inviteToken,
    });

    await createSession(user.user_id, req);

    return NextResponse.json({
      ok: true,
      user: { email: user.email, nickname: user.nickname, isAdmin: user.is_admin },
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message ?? "Registration failed" },
      { status: 400 },
    );
  }
}
