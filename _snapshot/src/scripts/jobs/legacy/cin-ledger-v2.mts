import { sql } from "legacy/opening";
import { logger } from "@/core/utils/logger";

type ExecArgs = {
  sessionId: number;
  ts: Date;
  from: string;
  to: string;
  executedUSDT: number;
  feeUSDT: number;
  slippageUSDT: number;
  refTarget?: number;
  plannedUSDT?: number;
  availableUSDT?: number;
  priceFromUSDT?: number;
  priceToUSDT?: number;
};

export async function execMoveV2(a: ExecArgs) {
  const [row] = await sql/*sql*/`
    select strategy_aux.cin_exec_move_v2(
      ${a.sessionId},
      ${a.ts},
      ${a.from},
      ${a.to},
      ${a.executedUSDT},
      ${a.feeUSDT},
      ${a.slippageUSDT},
      ${a.refTarget ?? null},
      ${a.plannedUSDT ?? null},
      ${a.availableUSDT ?? null},
      ${a.priceFromUSDT ?? null},
      ${a.priceToUSDT ?? null},
      ${a.priceFromUSDT ?? null}  -- bridge price equals from-asset price
    ) as move_id
  `;
  logger.info({ moveId: row.move_id, hop: `${a.from}->${a.to}` }, "cin move v2");
  return row.move_id as number;
}

export async function closeSessionV2(sessionId: number) {
  await sql/*sql*/`select strategy_aux.cin_close_session_v2(${sessionId})`;
}
