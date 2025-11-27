import { NextResponse } from "next/server";
import { cookies, headers } from "next/headers";
import { sql } from "@/core/db/db"; // <= usa a tua camada pg/ts
                               // se for diferente, me diz que ajusto
import { isEmailSuspended } from "@/lib/auth/suspension";
import { notifyAdminsOfInviteRequest } from "@/lib/notifications/invite";

// valida email simples (já resolve 99% dos casos)
function isValidEmail(v: string | null | undefined): boolean {
  if (!v) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim().toLowerCase());
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));

    const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    const nickname = typeof body.nickname === "string" ? body.nickname.trim() : null;
    const note = typeof body.note === "string" ? body.note.trim() : null;

    if (!isValidEmail(email)) {
      return NextResponse.json(
        { ok: false, error: "invalid_email" },
        { status: 400 }
      );
    }

    // Info de contexto
    const hdr = headers();
    const ip = hdr.get("x-forwarded-for")?.split(",")[0]?.trim() || null;
    const ua = hdr.get("user-agent") || null;

    // Verificar se já existe pendente / aprovado / rejeitado
    const existing = await sql`
      SELECT request_id, status
      FROM auth.invite_request
      WHERE lower(email) = ${email}
      ORDER BY created_at DESC
      LIMIT 1
    `;

    if (isEmailSuspended(email)) {
      return NextResponse.json(
        { ok: false, error: "suspended_email" },
        { status: 403 }
      );
    }

    if (existing.length > 0 && existing[0].status === "pending") {
      return NextResponse.json(
        { ok: false, error: "already_pending" },
        { status: 409 }
      );
    }

    // Criação do registro (with fallback for legacy schema)
    let row;
    try {
      row = await sql`
        INSERT INTO auth.invite_request (
          email,
          nickname,
          note,
          requested_from_ip,
          requested_user_agent
        )
        VALUES (${email}, ${nickname}, ${note}, ${ip}, ${ua})
        RETURNING request_id, created_at
      `;
    } catch (dbErr: any) {
      if (dbErr?.code === "42703") {
        // Legacy schema without note/ip columns
        row = await sql`
          INSERT INTO auth.invite_request (
            email,
            nickname,
            message
          )
          VALUES (${email}, ${nickname}, ${note})
          RETURNING request_id, created_at
        `;
      } else {
        throw dbErr;
      }
    }

    try {
      await notifyAdminsOfInviteRequest({ email, nickname, note });
    } catch (notifyErr) {
      console.warn("[invite/request] notify admins failed:", notifyErr);
    }

    try {
      await sql`
        INSERT INTO ops.admin_action_log (
          performed_email,
          target_email,
          action_type,
          action_scope,
          message,
          meta
        )
        VALUES (
          ${null},
          ${email},
          'invite.request',
          'invites',
          ${note ?? null},
          ${{
            requested_from_ip: ip,
            requested_user_agent: ua,
          }}
        )
      `;
    } catch (logErr) {
      console.warn("[invite/request] failed to log admin action:", logErr);
    }

    return NextResponse.json({
      ok: true,
      request_id: row[0].request_id,
      created_at: row[0].created_at,
    });
  } catch (err) {
    console.error("invite_request error:", err);
    return NextResponse.json(
      { ok: false, error: "server_error" },
      { status: 500 }
    );
  }
}
