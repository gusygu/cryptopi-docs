import { NextResponse } from "next/server";
import {
  resolvePreviewUniverseSnapshot,
  type PreviewUniverseOptions,
} from "./shared";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const toUpper = (value: string | null | undefined) =>
  String(value ?? "").trim().toUpperCase();

const parseSpotOnly = (value: string | null): boolean => {
  if (value === null || value === undefined) return true;
  const normalized = toUpper(value);
  if (!normalized) return true;
  if (normalized === "0" || normalized === "FALSE" || normalized === "NO") {
    return false;
  }
  return true;
};

export async function GET(req: Request) {
  const url = new URL(req.url);
  const options: PreviewUniverseOptions = {
    quote: url.searchParams.get("quote"),
    spotOnly: parseSpotOnly(url.searchParams.get("spotOnly")),
  };

  const snapshot = await resolvePreviewUniverseSnapshot(options);

  return NextResponse.json(
    {
      ok: true,
      quote: snapshot.quote,
      coins: snapshot.coins,
      cached: snapshot.cached,
      updatedAt: snapshot.updatedAt,
      note: snapshot.note,
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}
