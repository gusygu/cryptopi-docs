// src/app/api/matrices/commit/route.ts
import { NextResponse } from "next/server";
import { getPool } from "legacy/pool";
import {
  commitMatrixGrid,
  getMatrixStageTableIdent,
} from "@/core/db/db";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type Row = { base: string; quote: string; value: number; meta?: any };
type Body = {
  app_session_id: string;
  matrix_type: "benchmark"|"delta"|"pct24h"|"id_pct"|"pct_drv"|"pct_ref"|"ref";
  ts_ms: number;
  rows: Row[];
  coins_override?: string[];         // optional ["BTC","ETH",...]; if absent, uses settings coins
  idem?: string;                     // optional idempotency key
};

const NO_STORE = {
  "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
  Pragma: "no-cache",
  Expires: "0",
};

export async function POST(req: Request) {
  const cycleId = `commit-${Date.now()}`;
  try {
    const body = await req.json() as Body;
    const { app_session_id, matrix_type, ts_ms, rows, coins_override, idem } = body;

    if (!app_session_id || !matrix_type || !ts_ms || !Array.isArray(rows) || !rows.length) {
      return NextResponse.json({ ok:false, error:"missing fields" }, { status: 400, headers: NO_STORE });
    }

    // stage rows
    const client = await getPool().connect();
    try {
      await client.query("BEGIN");
      const stageTable = await getMatrixStageTableIdent(client);
      const text = `
        INSERT INTO ${stageTable}(ts_ms, matrix_type, base, quote, value, meta, app_session_id)
        VALUES ($1,$2,$3,$4,$5,COALESCE($6,'{}'::jsonb),$7)
        ON CONFLICT (ts_ms, matrix_type, base, quote)
        DO UPDATE SET value=EXCLUDED.value, meta=EXCLUDED.meta, app_session_id=EXCLUDED.app_session_id
      `;
      const coinSet = new Set<string>();
      for (const r of rows) {
        if (!r || !r.base || !r.quote || r.base.toUpperCase()===r.quote.toUpperCase()) continue;
        const base = r.base.toUpperCase();
        const quote = r.quote.toUpperCase();
        coinSet.add(base);
        coinSet.add(quote);
        await client.query(text, [ts_ms, matrix_type, base, quote, Number(r.value), r.meta ?? {}, app_session_id]);
      }

      // commit + validate
      const coinsForCommit = coins_override && coins_override.length
        ? Array.from(new Set(coins_override.map((c) => String(c ?? "").toUpperCase()).filter(Boolean)))
        : Array.from(coinSet);
      const report = await commitMatrixGrid({
        appSessionId: app_session_id,
        matrixType: matrix_type,
        tsMs: ts_ms,
        coins: coinsForCommit,
        idem,
        client,
      });
      await client.query("COMMIT");
      return NextResponse.json({ ok:true, report }, { headers: { ...NO_STORE, "x-cycle-id": cycleId } });
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }
  } catch (e: any) {
    return NextResponse.json({ ok:false, error:String(e?.message ?? e) }, { status: 500, headers: { ...NO_STORE, "x-cycle-id": cycleId } });
  }
}
