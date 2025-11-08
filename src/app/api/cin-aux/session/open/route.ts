import { NextResponse } from "next/server";
import { withTransaction, getPool } from "@/core/features/cin-aux/db";

async function detectSessionIdType(): Promise<"uuid" | "bigint"> {
  const q = await getPool().query(`
    SELECT data_type
    FROM information_schema.columns
    WHERE table_schema='strategy_aux'
      AND table_name='cin_session'
      AND column_name='session_id'
    LIMIT 1;
  `);
  const t = (q.rows[0]?.data_type || "").toLowerCase();
  if (t.includes("uuid")) return "uuid";
  if (t.includes("bigint") || t.includes("int8")) return "bigint";
  throw new Error(`cin_session.session_id has unexpected type: ${q.rows[0]?.data_type}`);
}

export async function POST(req: Request) {
  // tolerant body parsing
  let payload: any = {};
  try {
    if (req.headers.get("content-type")?.includes("application/json")) {
      payload = await req.json();
    }
  } catch {}

  try {
    const idType = await detectSessionIdType();

    if (idType === "uuid") {
      const sessionId: string = payload.sessionId ?? crypto.randomUUID();
      await withTransaction(async (c) => {
        await c.query(
          `INSERT INTO strategy_aux.cin_session (session_id)
           VALUES ($1::uuid)
           ON CONFLICT (session_id) DO NOTHING`,
          [sessionId]
        );
        // try uuid signature first; ignore if function doesn’t exist
        try {
          await c.query(
            `SELECT strategy_aux.cin_ensure_balance_row($1::uuid, 'USDT')`,
            [sessionId]
          );
        } catch { /* ok if function signature is bigint-only */ }
      });
      return NextResponse.json({ sessionId }, { status: 201 });
    } else {
      // bigint mode
      // if caller provided a number-like id, use it; otherwise mint one from DB
      let sessionId: string | number = payload.sessionId;
      if (!sessionId) {
        // prefer a sequence if present; else fall back to max+1
        const s = await getPool().query(`
          SELECT
            (SELECT relname FROM pg_class WHERE relkind='S'
             AND relnamespace=(SELECT oid FROM pg_namespace WHERE nspname='strategy_aux')
             AND relname LIKE 'cin_session%id%seq' LIMIT 1) AS seq;
        `);
        if (s.rows[0]?.seq) {
          const r = await getPool().query(`SELECT nextval('strategy_aux.${s.rows[0].seq}') AS id`);
          sessionId = r.rows[0].id;
        } else {
          const r = await getPool().query(`
            SELECT COALESCE(MAX(session_id),0) + 1 AS id
            FROM strategy_aux.cin_session
          `);
          sessionId = r.rows[0].id;
        }
      }
      await withTransaction(async (c) => {
        await c.query(
          `INSERT INTO strategy_aux.cin_session (session_id)
           VALUES ($1::bigint)
           ON CONFLICT (session_id) DO NOTHING`,
          [sessionId]
        );
        // try bigint signature; if you only have uuid version, ignore
        try {
          await c.query(
            `SELECT strategy_aux.cin_ensure_balance_row($1::bigint, 'USDT')`,
            [sessionId]
          );
        } catch { /* ok if function signature is uuid-only */ }
      });
      return NextResponse.json({ sessionId }, { status: 201 });
    }
  } catch (e: any) {
    console.error("session/open error:", e);
    return NextResponse.json({ error: e?.message ?? String(e) }, { status: 500 });
  }
}
