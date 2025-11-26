import { NextResponse } from "next/server";
import { getSessionRollup } from "@/core/features/cin-aux";

export async function GET(_: Request, { params }: { params: { sessionId: string } }) {
  const row = await getSessionRollup(params.sessionId);
  return NextResponse.json(row);
}
