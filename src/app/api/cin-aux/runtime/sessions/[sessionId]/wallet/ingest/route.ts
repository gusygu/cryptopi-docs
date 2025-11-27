import { NextRequest, NextResponse } from "next/server";
import { db } from "@/core/db/db";
import { getCurrentUser } from "@/lib/auth/server";
import {
  ensureProfileEmailRow,
  backfillAccountTradesEmail,
} from "@/core/features/cin-aux/accountScope";

export async function POST(
  _req: NextRequest,
  ctx: { params: { sessionId: string } }
) {
  const sessionId = Number(ctx.params.sessionId);

  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json(
        { ok: false, error: "Sign-in required" },
        { status: 401 },
      );
    }

    await ensureProfileEmailRow(user.email, user.nickname ?? null);
    await backfillAccountTradesEmail(user.email);

    const q = await db.query<{ import_moves_from_account_trades: number }>(
      `select cin_aux.import_moves_from_account_trades($1,$2)`,
      [sessionId, user.email.toLowerCase()],
    );

    const importedMoves = q.rows[0]?.import_moves_from_account_trades ?? 0;

    // if you want, chain other functions here:
    // await db.query(`select cin_aux.recompute_runtime_rollup($1)`, [sessionId]);

    return NextResponse.json({
      ok: true,
      sessionId,
      importedMoves,
    });
  } catch (e: any) {
    console.error("[wallet/ingest]", e);
    return NextResponse.json(
      { ok: false, error: e?.message ?? "wallet ingest failed" },
      { status: 500 }
    );
  }
}
