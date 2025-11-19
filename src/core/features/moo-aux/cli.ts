// src/core/features/moo-aux/cli.ts
import { db } from "@/core/db/db";
import type { MoodSelection } from "./schema";

/** Persist chosen mood for a session (best-effort; table optional) */
export async function setMoodSelection(appSessionId: string, sel: MoodSelection) {
  try {
    await db.query(
      `INSERT INTO mea_mood_state (app_session_id, mn, seq_weights, greek_hint, updated_at)
       VALUES ($1,$2,$3,$4, NOW())
       ON CONFLICT (app_session_id) DO UPDATE
       SET mn=EXCLUDED.mn, seq_weights=EXCLUDED.seq_weights, greek_hint=EXCLUDED.greek_hint, updated_at=NOW()`,
      [appSessionId, sel.mn, JSON.stringify(sel.seqWeights ?? null), sel.greekHint ?? null]
    );
  } catch { /* table may not exist; ignore */ }
}

export async function getMoodSelection(appSessionId: string): Promise<MoodSelection | null> {
  try {
    const { rows } = await db.query(
      `SELECT mn, seq_weights, greek_hint FROM mea_mood_state WHERE app_session_id=$1`,
      [appSessionId]
    );
    if (!rows.length) return null;
    return {
      mn: rows[0].mn,
      seqWeights: rows[0].seq_weights ?? undefined,
      greekHint: rows[0].greek_hint ?? undefined
    };
  } catch { return null; }
}

