// src/core/features/cin-aux/ledger.ts
import { db } from "@/core/db/db";
export async function writeFlowLedger(appSessionId: string | null | undefined, ts_ms: number, payload: any) {
  try {
    await db.query(
      `INSERT INTO cin_flow_ledger (app_session_id, ts_ms, payload)
       VALUES ($1,$2,$3)`,
      [appSessionId ?? null, ts_ms, JSON.stringify(payload)]
    );
  } catch { /* optional table */ }
}
export async function readFlowLedger(appSessionId: string, limit = 50) {
  try {
    const { rows } = await db.query(
      `SELECT ts_ms, payload FROM cin_flow_ledger WHERE app_session_id=$1 ORDER BY ts_ms DESC LIMIT $2`,
      [appSessionId, limit]
    );
    return rows;
  } catch { return []; }
}
