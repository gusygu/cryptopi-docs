import type { QueryResultRow } from "pg";
import { db as pool } from "@/core/db";
import type { StrAuxDoc, WindowKey } from "../../../lab/legacy/auxiliary/str-aux/types";

const toNumber = (value: unknown): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : Date.now();
};

type DocRow = QueryResultRow & {
  id: string;
  pair_base: string;
  pair_quote: string;
  window_key: WindowKey;
  app_session_id: string;
  opening: unknown;
  nuclei: unknown;
  stats: unknown;
  stream: unknown;
  updated_ms: number | string;
};

type Key = { base: string; quote: string; window: WindowKey; appSessionId: string };

type SnapshotRow = QueryResultRow & { payload: StrAuxDoc };

type SnapshotInsertRow = QueryResultRow & { snapshot_id: string };

function rowToDoc(row: DocRow): StrAuxDoc {
  return {
    id: row.id,
    pair: {
      base: row.pair_base,
      quote: row.pair_quote,
      window: row.window_key,
      appSessionId: row.app_session_id,
    },
    opening: row.opening as StrAuxDoc["opening"],
    nuclei: row.nuclei as StrAuxDoc["nuclei"],
    stats: row.stats as StrAuxDoc["stats"],
    stream: row.stream as StrAuxDoc["stream"],
    updatedAt: Math.round(toNumber(row.updated_ms)),
  };
}

export const db = {
  pool,

  async upsert(doc: StrAuxDoc & { appSessionId: string }) {
    const q = `
      INSERT INTO strategy_aux.str_aux_doc
        (id, pair_base, pair_quote, window_key, app_session_id,
         opening, nuclei, stats, stream, updated_ms)
      VALUES
        ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
      ON CONFLICT (id) DO UPDATE SET
        opening    = EXCLUDED.opening,
        nuclei     = EXCLUDED.nuclei,
        stats      = EXCLUDED.stats,
        stream     = EXCLUDED.stream,
        updated_ms = EXCLUDED.updated_ms
      RETURNING *`;
    const v = [
      doc.id,
      doc.pair.base,
      doc.pair.quote,
      doc.pair.window,
      doc.pair.appSessionId!,
      JSON.stringify(doc.opening),
      JSON.stringify(doc.nuclei),
      JSON.stringify(doc.stats),
      JSON.stringify(doc.stream),
      doc.updatedAt,
    ];
    const r = await pool.query<DocRow>(q, v);
    return rowToDoc(r.rows[0]);
  },

  async getLatest(key: Key): Promise<StrAuxDoc | null> {
    const q = `
      SELECT *
      FROM strategy_aux.str_aux_doc
      WHERE pair_base=$1 AND pair_quote=$2 AND window_key=$3 AND app_session_id=$4
      ORDER BY updated_ms DESC
      LIMIT 1`;
    const v = [key.base, key.quote, key.window, key.appSessionId];
    const r = await pool.query<DocRow>(q, v);
    if (!r.rowCount) return null;
    return rowToDoc(r.rows[0]);
  },

  // ---- snapshots ----
  async insertSnapshot(doc: StrAuxDoc & { appSessionId: string }) {
    const q = `
      INSERT INTO strategy_aux.str_aux_snapshot
        (doc_id, pair_base, pair_quote, window_key, app_session_id, payload, updated_ms)
      VALUES
        ($1,$2,$3,$4,$5,$6,$7)
      RETURNING snapshot_id`;
    const v = [
      doc.id,
      doc.pair.base,
      doc.pair.quote,
      doc.pair.window,
      doc.pair.appSessionId!,
      JSON.stringify(doc),
      doc.updatedAt,
    ];
    const r = await pool.query<SnapshotInsertRow>(q, v);
    return r.rows[0];
  },

  async getLatestSnapshot(key: Key): Promise<StrAuxDoc | null> {
    const q = `
      SELECT payload
      FROM strategy_aux.str_aux_snapshot
      WHERE pair_base=$1 AND pair_quote=$2 AND window_key=$3 AND app_session_id=$4
      ORDER BY updated_ms DESC
      LIMIT 1`;
    const v = [key.base, key.quote, key.window, key.appSessionId];
    const r = await pool.query<SnapshotRow>(q, v);
    if (!r.rowCount) return null;
    return r.rows[0].payload;
  },

  async writeThroughUpsert(doc: StrAuxDoc & { appSessionId: string }) {
    const saved = await this.upsert(doc);
    await this.insertSnapshot(doc);
    return saved;
  },
};
