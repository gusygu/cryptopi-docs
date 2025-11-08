import type { PoolClient } from "pg";
import { getPool } from "legacy/pool";

export type CycleDomain = "matrices" | "mea" | "cin" | "str";

export interface CycleDoc {
  domain: CycleDomain;
  appSessionId: string;
  cycleTs: number;
  payload: any;
  pairsCount?: number | null;
  rowsCount?: number | null;
  notes?: string | null;
}

export async function saveCycleDocument(doc: CycleDoc, client?: PoolClient): Promise<void> {
  // NEW: feature flag (default OFF). Nothing happens unless DOCS_WRITE=1
  if ((process.env.DOCS_WRITE || "0") !== "1") return;

  try {
    const pool = getPool();
    const cx = client ?? (await pool.connect());
    const own = !client;
    try {
      await cx.query(
        `select public.upsert_cycle_document($1,$2,$3,$4,$5,$6,$7)`,
        [
          doc.domain,
          doc.appSessionId,
          doc.cycleTs,
          JSON.stringify(doc.payload),
          doc.pairsCount ?? null,
          doc.rowsCount ?? null,
          doc.notes ?? null,
        ]
      );
    } finally {
      if (own) cx.release();
    }
  } catch {
    // swallow — never break the API
  }
}
