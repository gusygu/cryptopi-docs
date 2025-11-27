import { NextResponse } from "next/server";
import { db } from "@/core/db/db";
import type { CinAssetTauRow } from "@/core/features/cin-aux/cinAuxContracts";

export async function GET(
  _req: Request,
  { params }: { params: { sessionId: string } },
) {
  const sessionId = Number(params.sessionId);
  if (!Number.isFinite(sessionId)) {
    return NextResponse.json(
      { ok: false, error: "Invalid session id" },
      { status: 400 },
    );
  }

  const { rows } = await db.query(
    `
      SELECT asset_id, imprint_usdt, luggage_usdt
        FROM cin_aux.v_rt_asset_tau
       WHERE session_id = $1
       ORDER BY asset_id
    `,
    [sessionId],
  );

  const payload: CinAssetTauRow[] = rows.map((row: any) => ({
    sessionId,
    assetId: row.asset_id,
    imprintUsdt: row.imprint_usdt?.toString() ?? "0",
    luggageUsdt: row.luggage_usdt?.toString() ?? "0",
  }));

  return NextResponse.json(payload);
}
