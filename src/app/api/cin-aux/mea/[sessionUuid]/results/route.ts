import { NextResponse } from "next/server";
import { getPool } from "@/core/features/cin-aux/db";
import type { CinMeaResultRow } from "@/core/features/cin-aux/cinAuxContracts";

export async function GET(
  _req: Request,
  { params }: { params: { sessionUuid: string } }
) {
  const pool = getPool();
  const { sessionUuid } = params;

  const { rows } = await pool.query(
    `
    SELECT
      a.mea_session_uuid,
      a.rt_session_id,
      a.symbol,
      a.mea_value,
      a.components,
      a.actual_luggage_usdt
    FROM cin_aux.v_mea_alignment a
    WHERE a.mea_session_uuid = $1::uuid
    `,
    [sessionUuid]
  );

  const result: CinMeaResultRow[] = rows.map((row: any) => ({
    sessionUuid: row.mea_session_uuid,
    symbol: row.symbol,
    meaValue: Number(row.mea_value),
    components: row.components,
    actualLuggageUsdt:
      row.actual_luggage_usdt != null
        ? Number(row.actual_luggage_usdt)
        : null,
    actualWeight: null,
    suggestedWeight: null,
    weightDelta: null,
    luggageScore: null,
  }));

  return NextResponse.json(result);
}
