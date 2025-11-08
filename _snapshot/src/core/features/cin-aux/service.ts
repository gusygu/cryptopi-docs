/**
 * core/features/cin-aux/service.ts
 * Core mechanics: imprint/luggage helpers and high-level flows.
 */

import type { ExecuteMoveInput, UUID, ImprintLuggage, CinMove } from "./types";
import { execMove, getMovesBySession, getSessionRollup } from "./repo";

/**
 * Imprint/Luggage model
 * - Imprint: residual profit momentum → we proxy as comp_profit_usdt - profit_consumed_usdt
 * - Luggage: burden retained → we proxy as fee + slippage + trace + principal_hit_usdt
 * You can refine these to match your exact whitepaper once finalized.
 */
export function computeImprintLuggage(m: Pick<CinMove,
  "compProfitUsdt" | "profitConsumedUsdt" |
  "feeUsdt" | "slippageUsdt" | "traceUsdt" | "principalHitUsdt"
>): ImprintLuggage {
  const toNum = (x: string | number | null | undefined) => Number(x ?? 0);
  const imprint = toNum(m.compProfitUsdt) - toNum(m.profitConsumedUsdt);
  const luggage = toNum(m.feeUsdt) + toNum(m.slippageUsdt) + toNum(m.traceUsdt) + toNum(m.principalHitUsdt);
  return {
    imprintUsdt: imprint,
    luggageUsdt: luggage,
    tauNetUsdt: imprint - luggage,
  };
}

/** Write a move atomically and return its id */
export async function applyMove(input: ExecuteMoveInput): Promise<UUID> {
  return execMove(input);
}

/** Convenience: write, then fetch fresh hydration + tau */
export async function applyMoveAndHydrate(input: ExecuteMoveInput) {
  const moveId = await execMove(input);
  const moves = await getMovesBySession(input.sessionId);
  const latest = moves.find(m => m.moveId === moveId) || moves[moves.length - 1];
  const tau = computeImprintLuggage(latest);
  const rollup = await getSessionRollup(input.sessionId);
  return { moveId, latest, tau, rollup };
}

/** Compute rolling τ_t per move for a session */
export async function getTauSeries(sessionId: UUID) {
  const moves = await getMovesBySession(sessionId);
  return moves.map(m => ({
    moveId: m.moveId,
    ts: m.ts,
    tau: computeImprintLuggage(m),
  }));
}