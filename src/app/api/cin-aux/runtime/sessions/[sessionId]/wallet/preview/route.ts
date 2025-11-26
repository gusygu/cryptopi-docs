import { NextResponse } from "next/server";
import { getPool } from "@/core/features/cin-aux/db";
import { getAccountBalances } from "@/core/sources/binanceAccount";

export async function GET(
  _req: Request,
  { params }: { params: { sessionId: string } }
) {
  const pool = getPool();
  const sessionId = Number(params.sessionId);

  if (!Number.isFinite(sessionId)) {
    return NextResponse.json({ error: "Invalid session id" }, { status: 400 });
  }

  // 1) ensure session exists (just sanity)
  const sess = await pool.query(
    `SELECT session_id FROM cin_aux.rt_session WHERE session_id = $1`,
    [sessionId]
  );
  if (sess.rowCount === 0) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }

  // 2) universe: enabled base assets from settings.coin_universe
  const uniRes = await pool.query<{ base_asset: string | null }>(
    `
    SELECT DISTINCT base_asset
    FROM settings.coin_universe
    WHERE enabled = true
    `
  );
  const universe = new Set(
    uniRes.rows
      .map((r) => (r.base_asset ?? "").toUpperCase())
      .filter((v) => v.length > 0)
  );

  // 3) Binance balances via core/sources/binanceAccount
  const balancesMap = await getAccountBalances(); // { [asset]: number }

  const preview = Object.entries(balancesMap)
    .map(([asset, free]) => {
      const total = Number(free) || 0;
      const assetUp = asset.toUpperCase();
      return {
        assetId: assetUp,
        free: total,
        locked: 0,
        total,
        inUniverse: universe.has(assetUp),
      };
    })
    .filter((b) => b.total > 0);

  const balancesOfInterest = preview.filter((b) => b.inUniverse);

  return NextResponse.json({
    sessionId,
    universeSize: universe.size,
    balancesRawCount: preview.length,
    balancesOfInterestCount: balancesOfInterest.length,
    balancesOfInterest,
  });
}
