import { NextResponse } from "next/server";
import { cookies, headers } from "next/headers";
import { sql } from "@/core/db/db"; // <= usa a tua camada pg/ts
                               // se for diferente, me diz que ajusto

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

    if (existing.length > 0 && existing[0].status === "pending") {
      return NextResponse.json(
        { ok: false, error: "already_pending" },
        { status: 409 }
      );
    }

    // Criação do registro
    const row = await sql`
      INSERT INTO auth.invite_request (email, nickname, note, requested_from_ip, requested_user_agent)
      VALUES (${email}, ${nickname}, ${note}, ${ip}, ${ua})
      RETURNING request_id, created_at
    `;

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
