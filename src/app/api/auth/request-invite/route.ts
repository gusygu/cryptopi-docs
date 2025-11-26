import { NextRequest, NextResponse } from "next/server";
import { query } from "@/core/db";

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const email = String(body.email || "").trim().toLowerCase();
  const nickname = String(body.nickname || "").trim() || null;
  const message = String(body.message || "").trim() || null;

  if (!email) {
    return NextResponse.json({ ok: false, error: "Email is required" }, { status: 400 });
  }

  await query(
    `insert into auth.invite_request (email, nickname, message)
     values ($1, $2, $3)`,
    [email, nickname, message],
  );

  await query(
    `insert into auth.audit_log (event, details)
     values ('invite.request', jsonb_build_object('email', $1))`,
    [email],
  );

  return NextResponse.json({ ok: true });
}
