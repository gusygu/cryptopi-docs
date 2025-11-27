import { query } from "@/core/db/pool_server";

export type UserCycleStatus = "ok" | "warn" | "idle" | "error";

async function fetchNextCycleSeq(ownerUserId: string): Promise<number> {
  const { rows } = await query<{ next_seq: string | null }>(
    `
      SELECT COALESCE(MAX(cycle_seq), -1) + 1 AS next_seq
        FROM audit.user_cycle_log
       WHERE owner_user_id = $1
    `,
    [ownerUserId],
  );
  const raw = rows[0]?.next_seq;
  return raw == null ? 0 : Number(raw) || 0;
}

export async function nextUserCycleSeq(ownerUserId: string): Promise<number> {
  return fetchNextCycleSeq(ownerUserId);
}

export async function insertUserCycleLog(entry: {
  ownerUserId: string;
  cycleSeq: number;
  sessionId?: string | number | null;
  status: UserCycleStatus;
  summary: string;
  payload?: unknown;
}) {
  await query(
    `
      INSERT INTO audit.user_cycle_log (
        owner_user_id,
        cycle_seq,
        session_id,
        status,
        summary,
        payload
      )
      VALUES ($1, $2, $3, $4, $5, $6)
    `,
    [
      entry.ownerUserId,
      entry.cycleSeq,
      entry.sessionId ?? null,
      entry.status,
      entry.summary,
      entry.payload ?? {},
    ],
  );
}

export async function appendUserCycleLog(entry: {
  ownerUserId: string;
  sessionId?: string | number | null;
  status: UserCycleStatus;
  summary: string;
  payload?: unknown;
}): Promise<number> {
  const cycleSeq = await fetchNextCycleSeq(entry.ownerUserId);
  await insertUserCycleLog({
    ...entry,
    cycleSeq,
  });
  return cycleSeq;
}

export async function insertStrSamplingLog(entry: {
  ownerUserId: string;
  cycleSeq?: number | null;
  symbol: string;
  windowLabel: string;
  sampleTimestamp: number | null;
  status: UserCycleStatus;
  message?: string | null;
  meta?: unknown;
}) {
  await query(
    `
      INSERT INTO audit.str_sampling_log (
        owner_user_id,
        cycle_seq,
        symbol,
        window_label,
        sample_ts,
        status,
        message,
        meta
      )
      VALUES ($1, $2, $3, $4, to_timestamp($5/1000.0), $6, $7, $8)
    `,
    [
      entry.ownerUserId,
      entry.cycleSeq ?? null,
      entry.symbol,
      entry.windowLabel,
      entry.sampleTimestamp ?? null,
      entry.status,
      entry.message ?? null,
      entry.meta ?? {},
    ],
  );
}
