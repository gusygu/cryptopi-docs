import { NextResponse } from "next/server";
import { getTauSeries } from "@/core/features/cin-aux";

export async function GET(_: Request, { params }: { params: { sessionId: string } }) {
  const series = await getTauSeries(params.sessionId);
  return NextResponse.json(series);
}
