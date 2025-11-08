/**
 * core/features/cin-aux/repo.ts
 * DB repository: all direct SQL interactions live here.
 */

import type { ExecuteMoveInput, UUID, CinMove, CinSessionRollup } from "./types";
import { withTransaction, getPool } from "./db";
import { SQL } from "./sql";

export async function execMove(input: ExecuteMoveInput): Promise<UUID> {
  const {
    sessionId, ts, fromAsset, toAsset, units, priceUsdt,
    feeUsdt = "0", slippageUsdt = "0",
    bridgeInUsdt = "0", bridgeOutUsdt = "0",
    devRefUsdt = "0", refTargetUsdt = null, note = null,
  } = input;

  return withTransaction(async (c) => {
    const q = await c.query(SQL.EXEC_MOVE, [
      sessionId, ts, fromAsset, toAsset, units, priceUsdt,
      feeUsdt, slippageUsdt, bridgeInUsdt, bridgeOutUsdt, devRefUsdt, refTargetUsdt, note
    ]);
    return q.rows[0].move_id as UUID;
  });
}

export async function getMovesBySession(sessionId: UUID): Promise<CinMove[]> {
  const pool = getPool();
  const q = await pool.query(SQL.MOVES_BY_SESSION, [sessionId]);
  // camelCase mapping
  return q.rows.map((r: any) => ({
    moveId: r.move_id,
    sessionId: r.session_id,
    ts: r.ts,
    fromAsset: r.from_asset,
    toAsset: r.to_asset,
    executedUsdt: r.executed_usdt,
    feeUsdt: r.fee_usdt,
    slippageUsdt: r.slippage_usdt,
    compPrincipalUsdt: r.comp_principal_usdt,
    compProfitUsdt: r.comp_profit_usdt,
    traceUsdt: r.trace_usdt,
    profitConsumedUsdt: r.profit_consumed_usdt,
    principalHitUsdt: r.principal_hit_usdt,
    devRefUsdt: r.dev_ref_usdt,
    pBridgeInUsdt: r.p_bridge_in_usdt,
    pBridgeOutUsdt: r.p_bridge_out_usdt,
    lotUnitsUsed: r.lot_units_used,
  }));
}

export async function getSessionRollup(sessionId: UUID): Promise<CinSessionRollup | null> {
  const pool = getPool();
  const q = await pool.query(SQL.SESSION_ROLLUP, [sessionId]);
  if (q.rowCount === 0) return null;
  const r = q.rows[0];
  return {
    sessionId: r.session_id,
    openingPrincipalUsdt: r.opening_principal_usdt,
    openingProfitUsdt: r.opening_profit_usdt,
    closingPrincipalUsdt: r.closing_principal_usdt,
    closingProfitUsdt: r.closing_profit_usdt,
  };
}