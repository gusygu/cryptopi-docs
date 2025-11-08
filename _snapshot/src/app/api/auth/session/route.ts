import { NextResponse } from "next/server";
import { cookies } from "next/headers";

async function readSessionEmail(): Promise<string | null> {
  const jar = await cookies();
  const raw = jar.get("session")?.value ?? "";
  const email = raw.split("|")[0]?.trim();
  return email?.length ? email.toLowerCase() : null;
}

export async function GET() {
  const email = await readSessionEmail();
  return NextResponse.json({ ok: true, email });
}
