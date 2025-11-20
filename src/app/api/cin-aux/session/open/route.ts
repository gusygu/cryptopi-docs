import { NextResponse } from "next/server";
import { withTransaction, getPool } from "@/core/features/cin-aux/db";
import { detectCinSessionIdType } from "@/core/features/cin-aux/session";

const DEFAULT_WINDOW_LABEL =
  process.env.NEXT_PUBLIC_CIN_DEFAULT_WINDOW_LABEL ||
  process.env.CIN_DEFAULT_WINDOW_LABEL ||
  "1h";

type SessionOpenPayload = {
  sessionId?: string | number;
  windowLabel?: string | null;
};

function resolveWindowLabel(raw?: string | null): string {
  const base = typeof raw === "string" ? raw : DEFAULT_WINDOW_LABEL;
  const trimmed = (base ?? "").trim();
  return trimmed.length ? trimmed : "1h";
}

export async function POST(req: Request) {
  // tolerant body parsing
  let payload: SessionOpenPayload = {};
  try {
    if (req.headers.get("content-type")?.includes("application/json")) {
      payload = await req.json();
    }
  } catch {}

  const windowLabel = resolveWindowLabel(payload.windowLabel);

  try {
    const idType = await detectCinSessionIdType();

    if (idType === "uuid") {
      const providedId = payload.sessionId;
      const sessionId: string =
        typeof providedId === "string" && providedId.trim().length
          ? providedId
          : crypto.randomUUID();
      await withTransaction(async (c) => {
        await c.query(
          `INSERT INTO strategy_aux.cin_session (session_id, window_label)
           VALUES ($1::uuid, $2::text)
           ON CONFLICT (session_id) DO NOTHING`,
          [sessionId, windowLabel]
        );
        // try uuid signature first; ignore if function doesn't exist
        try {
          await c.query(
            `SELECT strategy_aux.cin_ensure_balance_row($1::uuid, 'USDT')`,
            [sessionId]
          );
        } catch {
          /* ok if function signature is bigint-only */
        }
      });
      return NextResponse.json({ sessionId, windowLabel }, { status: 201 });
    } else {
      // bigint mode
      // if caller provided a number-like id, use it; otherwise mint one from DB
      let sessionId: string | number | undefined = payload.sessionId;
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
          `INSERT INTO strategy_aux.cin_session (session_id, window_label)
           VALUES ($1::bigint, $2::text)
           ON CONFLICT (session_id) DO NOTHING`,
          [sessionId, windowLabel]
        );
        // try bigint signature; if you only have uuid version, ignore
        try {
          await c.query(
            `SELECT strategy_aux.cin_ensure_balance_row($1::bigint, 'USDT')`,
            [sessionId]
          );
        } catch {
          /* ok if function signature is uuid-only */
        }
      });
      return NextResponse.json({ sessionId, windowLabel }, { status: 201 });
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unable to open session";
    console.error("session/open error:", err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
