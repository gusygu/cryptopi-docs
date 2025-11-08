import type { SessionId } from "./types";
import { getBalances, getMoves, getRollup } from "./service";

export async function selectLedgerSnapshot(sessionId: SessionId) {
  const [balances, moves, rollup] = await Promise.all([
    getBalances(sessionId),
    getMoves(sessionId),
    getRollup(sessionId),
  ]);
  return { balances, moves, rollup };
}
