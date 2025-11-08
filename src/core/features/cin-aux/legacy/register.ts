// src/core/features/cin-aux/register.ts
import { db } from "@/core/db/db";
import type { CinMetrics } from "./compute";

export async function saveCinMetrics(appSessionId: string | null | undefined, ts_ms: number, m: CinMetrics) {
  try {
    await db.query(
      `INSERT INTO cin_metrics (app_session_id, ts_ms, payload)
       VALUES ($1,$2,$3)
       ON CONFLICT (app_session_id, ts_ms) DO UPDATE SET payload=EXCLUDED.payload`,
      [appSessionId ?? null, ts_ms, JSON.stringify(m)]
    );
  } catch {}
}
