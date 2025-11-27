import { sql } from "@/core/db/db";
import { getCurrentSession } from "@/app/(server)/auth/session";

export type AdminActionLogInput = {
  actionType: string;
  actionScope?: string;
  targetUserId?: string | null;
  targetEmail?: string | null;
  message?: string;
  meta?: Record<string, unknown>;
};

/**
 * Logs an admin action into ops.admin_action_log.
 * Best-effort: it should NEVER throw in normal flow.
 */
export async function logAdminAction(input: AdminActionLogInput) {
  const session = await getCurrentSession().catch(() => null);

  const meta = input.meta ?? {};
  try {
    await sql`
      INSERT INTO ops.admin_action_log (
        performed_by,
        performed_email,
        target_user_id,
        target_email,
        action_type,
        action_scope,
        message,
        meta
      )
      VALUES (
        ${session?.userId ?? null},
        ${session?.email ?? null},
        ${input.targetUserId ?? null},
        ${input.targetEmail ?? null},
        ${input.actionType},
        ${input.actionScope ?? null},
        ${input.message ?? null},
        ${meta}
      )
    `;
  } catch {
    // swallow on purpose: logging must not break the main flow
  }
}
