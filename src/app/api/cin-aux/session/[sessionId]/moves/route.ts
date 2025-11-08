import { NextResponse } from "next/server";
import { getMovesBySession } from "@/core/features/cin-aux";

export async function GET(_: Request, { params }: { params: { sessionId: string } }) {
  const rows = await getMovesBySession(params.sessionId);
  return NextResponse.json(rows);
}
