// api_cinRuntimeSessions.ts
// Example handler for GET /api/cin/runtime/sessions
// This is a sketch: adapt imports and DB access to your stack.

import type { NextApiRequest, NextApiResponse } from "next";
import type { CinRuntimeSessionSummary } from "../contracts/cinAuxContracts";

// TODO: replace with your own DB client (e.g. pg, drizzle, kysely...)
import { pool } from "../db/pool"; // placeholder

// Helper to map a DB row into a CinRuntimeSessionSummary
function mapRowToSessionSummary(row: any): CinRuntimeSessionSummary {
  const deltaRatio = row.delta_ratio as number | null;

  let status: CinRuntimeSessionSummary["status"] = "balanced";
  if (deltaRatio != null) {
    const abs = Math.abs(deltaRatio);
    if (abs >= 0.02) status = "broken";      // >= 2% drift
    else if (abs >= 0.005) status = "drifted"; // 0.5%–2% drift
  }

  return {
    sessionId: Number(row.session_id),
    windowLabel: row.window_label,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    closed: row.closed,

    imprintPrincipalChurnUsdt: row.imprint_principal_churn_usdt ?? "0",
    imprintProfitChurnUsdt: row.imprint_profit_churn_usdt ?? "0",
    imprintGeneratedProfitUsdt: row.imprint_generated_profit_usdt ?? "0",
    imprintTraceSumUsdt: row.imprint_trace_sum_usdt ?? "0",
    imprintDevrefSumUsdt: row.imprint_devref_sum_usdt ?? "0",
    luggageTotalPrincipalUsdt: row.luggage_total_principal_usdt ?? "0",
    luggageTotalProfitUsdt: row.luggage_total_profit_usdt ?? "0",

    cinTotalMtmUsdt: row.cin_total_mtm_usdt ?? null,
    refTotalUsdt: row.ref_total_usdt ?? null,
    deltaUsdt: row.delta_usdt ?? null,
    deltaRatio: row.delta_ratio ?? null,

    status,
  };
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<CinRuntimeSessionSummary[] | { error: string }>
) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  try {
    const { rows } = await pool.query(`
      SELECT
        s.session_id,
        s.window_label,
        s.started_at,
        s.ended_at,
        s.closed,
        il.imprint_principal_churn_usdt,
        il.imprint_profit_churn_usdt,
        il.imprint_generated_profit_usdt,
        il.imprint_trace_sum_usdt,
        il.imprint_devref_sum_usdt,
        il.luggage_total_principal_usdt,
        il.luggage_total_profit_usdt,
        r.cin_total_mtm_usdt,
        r.ref_total_usdt,
        r.delta_usdt,
        r.delta_ratio
      FROM cin_aux.v_rt_session_summary s
      LEFT JOIN cin_aux.v_rt_session_recon r
        ON r.session_id = s.session_id
      LEFT JOIN cin_aux.rt_imprint_luggage il
        ON il.session_id = s.session_id
      ORDER BY s.started_at DESC;
    `);

    const sessions = rows.map(mapRowToSessionSummary);
    return res.status(200).json(sessions);
  } catch (err) {
    console.error("Error fetching cin runtime sessions:", err);
    return res.status(500).json({ error: "Internal Server Error" });
  }
}
