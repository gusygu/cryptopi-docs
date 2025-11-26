import { NextResponse } from "next/server";
import { getPool } from "@/core/features/cin-aux/db";

export async function GET(
  _req: Request,
  { params }: { params: { sessionUuid: string } }
) {
  const pool = getPool();
  const { sessionUuid } = params;

  try {
    const { rows } = await pool.query(
      `
      SELECT
        mea_session_uuid,
        rt_session_id,
        symbol,
        mea_value,
        actual_luggage_usdt,
        suggested_weight,
        actual_weight,
        weight_delta,
        abs_delta,
        severity_level,
        alignment_score,
        need_rebalance
      FROM cin_aux.v_mea_alignment_scored
      WHERE mea_session_uuid = $1::uuid
      ORDER BY symbol;
      `,
      [sessionUuid]
    );

    return NextResponse.json(rows);
  } catch (err) {
    console.error("v_mea_alignment_scored error:", err);
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 500 }
    );
  }
}
