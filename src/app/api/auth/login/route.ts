import { NextRequest, NextResponse } from "next/server";
import { query } from "@/core/db";
import { createSession, verifyPassword } from "@/lib/auth/server";

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const email = String(body.email || "").trim().toLowerCase();
  const password = String(body.password || "");

  if (!email || !password) {
    return NextResponse.json(
      { ok: false, error: "Email and password are required" },
      { status: 400 },
    );
  }

  const { rows } = await query<{ user_id: string; password_hash: string; status: string }>(
    `select user_id, password_hash, status
       from auth."user"
      where email = $1`,
    [email],
  );
  const row = rows[0];
  if (!row || row.status !== "active") {
    return NextResponse.json({ ok: false, error: "Invalid credentials" }, { status: 401 });
  }

  const valid = await verifyPassword(password, row.password_hash);
  if (!valid) {
    return NextResponse.json({ ok: false, error: "Invalid credentials" }, { status: 401 });
  }

  await createSession(row.user_id, req);
  return NextResponse.json({ ok: true });
}
