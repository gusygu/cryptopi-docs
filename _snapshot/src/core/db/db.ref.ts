// src/core/db/reference.ts
import { db } from "./db";

/** Row shape from `snapshots` (Postgres folds unquoted to lowercase). */
export type ReferenceRow = {
  id: string;
  ref: string;
  targetts: number;             // NOTE: access as 'targetts' in rows
  ts_epoch_ms: number;
  created_at: string;
  is_freeze: boolean;
  app_session_id: string | null;
  epoch_rec_ms: number | null;
  overall_no: number | null;
  session_no: number | null;
  client_uploaded: boolean;
  client_uploaded_at: string | null;
};

/** Create a new reference (aka freeze-shot). */
export async function createReference(ref: string, targetTs: number, appSessionId?: string) {
  const { rows } = await db.query<{ id: string; overall_no: string; session_no: number }>(
    `SELECT * FROM create_reference($1,$2,$3,$4)`,
    [ref, targetTs, appSessionId ?? null, true]
  );
  return rows[0];
}

/** Nearest reference to an arbitrary timestamp. */
export async function nearestReference(ts: number, opts?: { ref?: string; appSessionId?: string }) {
  const { rows } = await db.query<ReferenceRow>(
    `SELECT * FROM reference_nearest($1,$2,$3)`,
    [ts, opts?.ref ?? null, opts?.appSessionId ?? null]
  );
  return rows[0] ?? null;
}

export async function prevReference(targetTs: number, opts?: { ref?: string; appSessionId?: string }) {
  const { rows } = await db.query<ReferenceRow>(
    `SELECT * FROM reference_prev($1,$2,$3)`,
    [targetTs, opts?.ref ?? null, opts?.appSessionId ?? null]
  );
  return rows[0] ?? null;
}

export async function nextReference(targetTs: number, opts?: { ref?: string; appSessionId?: string }) {
  const { rows } = await db.query<ReferenceRow>(
    `SELECT * FROM reference_next($1,$2,$3)`,
    [targetTs, opts?.ref ?? null, opts?.appSessionId ?? null]
  );
  return rows[0] ?? null;
}

/** List references (paged window) for timelines/carousels. */
export async function listReferences(opts?: {
  ref?: string; appSessionId?: string; beforeTs?: number; afterTs?: number; limit?: number;
}) {
  const { rows } = await db.query<ReferenceRow>(
    `SELECT * FROM reference_list($1,$2,$3,$4,$5)`,
    [opts?.ref ?? null, opts?.appSessionId ?? null, opts?.beforeTs ?? null, opts?.afterTs ?? null, opts?.limit ?? 50]
  );
  return rows;
}

/** Client sync flags. */
export async function markReferenceUploaded(id: string, uploaded = true) {
  await db.query(`SELECT reference_mark_uploaded($1,$2)`, [id, uploaded]);
}
export async function listPendingReferences(limit = 100) {
  const { rows } = await db.query<ReferenceRow>(
    `SELECT * FROM snapshots WHERE is_freeze = true AND client_uploaded = false ORDER BY targetTs DESC LIMIT $1`,
    [limit]
  );
  return rows;
}

/** Backwards-compat exports (old names) — optional: remove once callers updated. */
export {
  createReference as createSnapshotRef,
  nearestReference as nearestFreezeShot,
  prevReference as prevFreezeShot,
  nextReference as nextFreezeShot,
  listReferences as listFreezeShots,
  markReferenceUploaded as markFreezeShotUploaded,
  listPendingReferences as listPendingUploads,
};
