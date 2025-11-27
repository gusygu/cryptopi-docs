import { NextResponse } from "next/server";
import { getPool } from "@/core/features/cin-aux/db";
import type { CinRuntimeMoveRow } from "@/core/features/cin-aux/cinAuxContracts";

export async function GET(
  _req: Request,
  { params }: { params: { sessionId: string } }
) {
  const pool = getPool();
  const id = Number(params.sessionId);

  const { rows } = await pool.query(
    `
    SELECT
      move_id,
      session_id,
      ts,
      from_asset,
      to_asset,
      executed_usdt,
      fee_usdt,
      slippage_usdt,
      ref_usdt_target,
      planned_usdt,
      dev_ref_usdt,
      comp_principal_usdt,
      comp_profit_usdt,
      p_bridge_in_usdt,
      p_bridge_out_usdt,
      lot_units_used,
      from_units,
      trace_usdt,
      profit_consumed_usdt,
      principal_hit_usdt,
      to_units_received,
      residual_from_after,
      notes,
      src_symbol,
      src_trade_id,
      src_side,
      pnl_for_move_usdt,
      fee_rate
    FROM cin_aux.v_rt_move_pnl
    WHERE session_id = $1
    ORDER BY ts
    `,
    [id]
  );

  const moves: CinRuntimeMoveRow[] = rows.map((r: any) => ({
    moveId: Number(r.move_id),
    sessionId: Number(r.session_id),
    ts: r.ts,
    fromAsset: r.from_asset,
    toAsset: r.to_asset,
    srcSymbol: r.src_symbol ?? null,
    srcTradeId: r.src_trade_id?.toString() ?? null,
    srcSide: r.src_side ?? null,
    executedUsdt: r.executed_usdt?.toString() ?? "0",
    feeUsdt: r.fee_usdt?.toString() ?? "0",
    slippageUsdt: r.slippage_usdt?.toString() ?? "0",
    refUsdtTarget: r.ref_usdt_target?.toString() ?? null,
    plannedUsdt: r.planned_usdt?.toString() ?? null,
    devRefUsdt: r.dev_ref_usdt?.toString() ?? null,
    compPrincipalUsdt: r.comp_principal_usdt?.toString() ?? "0",
    compProfitUsdt: r.comp_profit_usdt?.toString() ?? "0",
    pBridgeInUsdt: r.p_bridge_in_usdt?.toString() ?? null,
    pBridgeOutUsdt: r.p_bridge_out_usdt?.toString() ?? null,
    lotUnitsUsed: r.lot_units_used?.toString() ?? null,
    fromUnits: r.from_units?.toString() ?? null,
    traceUsdt: r.trace_usdt?.toString() ?? "0",
    profitConsumedUsdt: r.profit_consumed_usdt?.toString() ?? "0",
    principalHitUsdt: r.principal_hit_usdt?.toString() ?? "0",
    toUnitsReceived: r.to_units_received?.toString() ?? null,
    residualFromAfter: r.residual_from_after?.toString() ?? null,
    notes: r.notes ?? null,
    pnlForMoveUsdt: r.pnl_for_move_usdt?.toString() ?? null,
    feeRate: r.fee_rate?.toString() ?? null,
    effectivePriceFrom:
      r.from_units && Number(r.from_units) !== 0
        ? (Number(r.executed_usdt ?? 0) / Number(r.from_units)).toString()
        : null,
  }));

  return NextResponse.json(moves);
}
