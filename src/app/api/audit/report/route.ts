import { NextResponse } from "next/server";
import { requireUserSession } from "@/app/(server)/auth/session";
import { sql } from "@/core/db/db";

export async function POST(req: Request) {
  const session = await requireUserSession();
  const body = await req.json().catch(() => ({}));
  const cycleSeq = Number(body.cycleSeq ?? null);
  const category = String(body.category || "issue");
  const severity = String(body.severity || "medium");
  const note = typeof body.note === "string" ? body.note.trim() : null;

  const [report] = await sql`
    INSERT INTO audit.user_reports (
      owner_user_id,
      cycle_seq,
      category,
      severity,
      note
    )
    VALUES (${session.userId}, ${Number.isFinite(cycleSeq) ? cycleSeq : null}, ${category}, ${severity}, ${note})
    RETURNING report_id, created_at
  `;

  await sql`
    INSERT INTO audit.error_queue (
      origin,
      owner_user_id,
      cycle_seq,
      summary,
      details
    )
    VALUES (
      'user',
      ${session.userId},
      ${Number.isFinite(cycleSeq) ? cycleSeq : null},
      ${`User report (${category}/${severity})`},
      ${{
        report_id: report.report_id,
        note,
      }}
    )
  `;

  return NextResponse.json({ ok: true, report_id: report.report_id });
}
