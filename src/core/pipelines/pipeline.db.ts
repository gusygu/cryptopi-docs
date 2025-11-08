// src/core/pipelines/pipeline.db.ts
import { db } from "@/core/db/db";
import { TABLES } from "@/core/db/pool_server";
import type { MatrixType } from "./types";

export async function getPrevMatrixValue(
  matrix_type: MatrixType,
  base: string,
  quote: string,
  beforeTs: number
): Promise<number | null> {
  const { rows } = await db.query<{ value: number }>(
    `SELECT value FROM ${TABLES.matrices}
      WHERE matrix_type=$1 AND base=$2 AND quote=$3 AND ts_ms < $4
   ORDER BY ts_ms DESC LIMIT 1`,
    [matrix_type, base, quote, beforeTs]
  );
  return rows.length ? Number(rows[0].value) : null;
}

export async function upsertMatrixGrid(
  matrix_type: MatrixType,
  bases: string[],
  quote: string,
  grid: (number | null)[][],
  ts_ms: number
) {
  const rows: { base: string; quote: string; value: number }[] = [];
  const n = bases.length;
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
    if (i === j) continue;
    const val = grid[i]?.[j];
    if (val == null || !Number.isFinite(val)) continue;
    rows.push({ base: bases[i], quote: bases[j], value: Number(val) });
  }
  if (!rows.length) return 0;

  const cols = ["matrix_type", "base", "quote", "ts_ms", "value"];
  const values = rows.flatMap(r => [matrix_type, r.base, r.quote, ts_ms, r.value]);
  const placeholders = rows.map((_, idx) => {
    const o = idx * cols.length;
    return `($${o+1},$${o+2},$${o+3},$${o+4},$${o+5})`;
  }).join(",");

  await db.query(
    `INSERT INTO ${TABLES.matrices} (${cols.join(",")})
      VALUES ${placeholders}
      ON CONFLICT (matrix_type, base, quote, ts_ms)
      DO UPDATE SET value=EXCLUDED.value`,
    values
  );
  return rows.length;
}

// src/core/pipelines/db_pipeline.ts (additions)

// 1) Generic "latest before" reader for any table/keys
export async function readLatestBefore<T>(
  sql: string,               // SELECT ... WHERE ... AND ts < $n ORDER BY ts DESC LIMIT 1
  params: any[]              // bound params
): Promise<T | null> {
  const { rows } = await db.query(sql, params);
  return rows.length ? (rows[0] as T) : null;
}

// 2) Generic upsert-one
export async function upsertOne(
  sql: string,               // INSERT ... ON CONFLICT (...) DO UPDATE SET ...
  params: any[]
): Promise<void> {
  await db.query(sql, params);
}

// 3) Generic upsert-batch
export async function upsertBatch(
  sql: string,               // INSERT ... VALUES ($1,...),($k,...) ON CONFLICT ...
  flatParams: any[]
): Promise<void> {
  if (!flatParams.length) return;
  await db.query(sql, flatParams);
}

// 4) A tiny registry enum for clarity (optional)
export type DataKind = "matrix" | "metric" | "document";

// Example usage: read a metric
export async function getPrevMetricValue(
  metricKey: string, beforeTs: number
): Promise<number | null> {
  const row = await readLatestBefore<{ value: number }>(
    `SELECT value FROM metrics WHERE metric_key=$1 AND ts_epoch_ms < $2 ORDER BY ts_epoch_ms DESC LIMIT 1`,
    [metricKey, beforeTs]
  );
  return row ? Number(row.value) : null;
}

