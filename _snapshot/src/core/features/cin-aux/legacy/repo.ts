import { sql, withConn } from "../../../db/client";
import type { MoveParamsV2 } from "./types";

// ——— sessions ———
export async function createCinSession(windowLabel: string) {
  const rows = await sql<{ session_id: number }>(
    `insert into strategy_aux.cin_session(window_label) values ($1) returning session_id`,
    windowLabel
  );
  return rows[0].session_id;
}

export async function closeCinSessionV2(sessionId: number) {
  await sql(`select strategy_aux.cin_close_session_v2($1)`, sessionId);
}

export async function ensureBalanceRow(sessionId: number, assetId: string) {
  await sql(
    `insert into strategy_aux.cin_balance(session_id, asset_id, opening_principal, opening_profit, principal_usdt, profit_usdt)
     values ($1,$2,0,0,0,0)
     on conflict (session_id, asset_id) do nothing`,
     sessionId, assetId
  );
}

export async function seedBalance(
  sessionId: number,
  assetId: string,
  principalUSDT: number,
  profitUSDT: number
) {
  await ensureBalanceRow(sessionId, assetId);
  await sql(
    `update strategy_aux.cin_balance
       set opening_principal = $3,
           opening_profit    = $4,
           principal_usdt    = $3,
           profit_usdt       = $4
     where session_id = $1 and asset_id = $2`,
    sessionId, assetId, principalUSDT, profitUSDT
  );
}

// ——— marks ———
export async function addMark(sessionId: number, assetId: string, bulkUSDT: number, ts: Date = new Date()) {
  await sql(
    `insert into strategy_aux.cin_mark(session_id, asset_id, ts, bulk_usdt)
     values ($1,$2,$3,$4)
     on conflict do nothing`,
     sessionId, assetId, ts, bulkUSDT
  );
}

// ——— move v2 ———
export async function execMoveV2(p: MoveParamsV2) {
  const rows = await sql<{ strategy_aux_cin_exec_move_v2: number }>(
    `select strategy_aux.cin_exec_move_v2($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
    p.sessionId, p.ts, p.fromAsset, p.toAsset, p.executedUSDT, p.feeUSDT, p.slippageUSDT,
    p.refTargetUSDT ?? null, p.plannedUSDT ?? null, p.availableUSDT ?? null,
    p.priceFromUSDT ?? null, p.priceToUSDT ?? null, p.priceBridgeUSDT ?? null
  );
  return rows[0].strategy_aux_cin_exec_move_v2;
}

// convenience: register acquisition (usually not used directly because exec_move v2 does it)
export async function registerAcquisition(
  sessionId: number, moveId: number, assetId: string, units: number, priceUSDT: number
) {
  const rows = await sql<{ strategy_aux_cin_register_acquisition: number }>(
    `select strategy_aux.cin_register_acquisition($1,$2,$3,$4,$5)`,
    sessionId, moveId, assetId, units, priceUSDT
  );
  return rows[0].strategy_aux_cin_register_acquisition;
}
