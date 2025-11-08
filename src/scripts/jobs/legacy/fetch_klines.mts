// src/scripts/jobs/fetch_klines.mts
import type { PoolClient } from "pg";
import { getPool } from "../../../../legacy/pool";

type Kline = {
  openTime: number; open: string; high: string; low: string;
  close: string; volume: string; closeTime: number;
};

const pool = getPool();
const BINANCE_BASE = process.env.BINANCE_API_BASE ?? "https://api.binance.com";
const INTERVAL = process.env.KLINE_INTERVAL ?? "1m";
const SYMBOLS = (process.env.SYMBOLS ?? "BTCUSDT,ETHUSDT").split(",").map(s => s.trim()).filter(Boolean);
const LOOKBACK_MS = Number(process.env.BATCH_LOOKBACK_MS ?? 6 * 60 * 60 * 1000); // 6h

const log = (...a: any[]) => console.log(new Date().toISOString(), ...a);

// ---------------------- provider ----------------------
async function fetchKlines(symbol: string, interval: string, startTime?: number, endTime?: number): Promise<Kline[]> {
  const u = new URL("/api/v3/klines", BINANCE_BASE);
  u.searchParams.set("symbol", symbol);
  u.searchParams.set("interval", interval);
  if (startTime != null) u.searchParams.set("startTime", String(startTime));
  if (endTime   != null) u.searchParams.set("endTime",   String(endTime));
  u.searchParams.set("limit", "1000");
  const res = await fetch(u.toString());
  if (!res.ok) throw new Error(`Binance ${res.status}: ${await res.text()}`);
  const raw = (await res.json()) as any[];
  return raw.map(r => ({
    openTime: r[0], open: r[1], high: r[2], low: r[3],
    close: r[4], volume: r[5], closeTime: r[6],
  }));
}

// ---------------------- session helpers ----------------------
async function beginSession(c: PoolClient, label: string) {
  const { rows } = await c.query<{ sid: string }>(`SELECT public.begin_cp_session($1) AS sid`, [label]);
  return rows[0].sid;
}
async function endSession(c: PoolClient, sid: string) {
  await c.query(`SELECT public.end_cp_session($1)`, [sid]);
}

// ---------------------- schema introspection ----------------------
type SamplesShape = {
  table: string;                 // 'str_aux.samples'
  useTsMs: boolean;              // write ts_ms or timestamptz?
  tsCol?: string;                // timestamptz column name (if not using ts_ms)
  symCol: string;                // symbol/pair column
  priceCol: string;              // price/close column
  volCol: string;                // volume/qty column
};

async function inspectSamples(c: PoolClient): Promise<SamplesShape> {
  const table = `str_aux.samples`;
  const { rows } = await c.query<{ column_name: string; data_type: string }>(
    `SELECT column_name, data_type
       FROM information_schema.columns
      WHERE table_schema='str_aux' AND table_name='samples'`
  );
  if (!rows.length) throw new Error(`Table ${table} not found`);

  const cols = rows.map(r => ({ name: r.column_name, type: r.data_type.toLowerCase() }));

  const hasTsMs = cols.some(c => c.name === "ts_ms" && c.type.includes("bigint"));
  const tsCol = hasTsMs ? undefined :
    // pick first timestamptz-ish column not named created_at/updated_at
    cols.find(c => c.type.includes("timestamp") && !["created_at","updated_at"].includes(c.name))?.name;

  // symbol column preference
  const symCol =
    cols.find(c => ["symbol","pair","market","asset"].includes(c.name))?.name
    ?? cols.find(c => c.type.includes("character"))?.name
    ?? "symbol";

  // price column preference
  const priceCol =
    cols.find(c => ["price","close","last"].includes(c.name))?.name
    ?? cols.find(c => c.type.includes("numeric"))?.name
    ?? "price";

  // volume column preference
  const volCol =
    cols.find(c => ["volume","qty","quantity","amount"].includes(c.name))?.name
    ?? cols.find(c => c.type.includes("numeric") && cols.find(cc => cc.name === priceCol) !== c)?.name
    ?? "volume";

  // sanity
  if (!hasTsMs && !tsCol) {
    throw new Error(`No timestamp column found in ${table}. Add a timestamptz column (e.g., "ts" or "at") or a bigint "ts_ms".`);
  }

  return { table, useTsMs: hasTsMs, tsCol, symCol, priceCol, volCol };
}

// ---------------------- db ops ----------------------
async function lastKnownClose(c: PoolClient, shape: SamplesShape, symbol: string): Promise<number | null> {
  if (shape.useTsMs) {
    const { rows } = await c.query<{ ts_ms: string | number }>(
      `SELECT MAX(ts_ms) AS ts_ms FROM ${shape.table} WHERE ${shape.symCol} = $1`, [symbol]
    );
    const v = rows[0]?.ts_ms; return v == null ? null : Number(v);
  } else {
    // convert timestamptz to ms
    const { rows } = await c.query<{ t: string }>(
      `SELECT EXTRACT(EPOCH FROM MAX(${shape.tsCol!})) * 1000 AS t
         FROM ${shape.table}
        WHERE ${shape.symCol} = $1`, [symbol]
    );
    const v = rows[0]?.t; return v == null ? null : Math.floor(Number(v));
  }
}

async function insertKlines(c: PoolClient, runId: string, shape: SamplesShape, symbol: string, kl: Kline[]) {
  if (!kl.length) return;

  if (shape.useTsMs) {
    // INSERT ... (run_id, symCol, ts_ms, priceCol, volCol)
    const colsPer = 5;
    const values: any[] = [];
    const chunks: string[] = [];
    for (let i = 0; i < kl.length; i++) {
      const k = kl[i];
      const b = i * colsPer;
      values.push(runId, symbol, k.closeTime, k.close, k.volume);
      chunks.push(`($${b+1},$${b+2},$${b+3},$${b+4},$${b+5})`);
    }
    const sql = `
      INSERT INTO ${shape.table} (run_id, ${shape.symCol}, ts_ms, ${shape.priceCol}, ${shape.volCol})
      VALUES ${chunks.join(",")}
      ON CONFLICT DO NOTHING
    `;
    await c.query(sql, values);
  } else {
    // INSERT ... (run_id, symCol, tsCol(timestamptz), priceCol, volCol)
    const colsPer = 5;
    const values: any[] = [];
    const chunks: string[] = [];
    for (let i = 0; i < kl.length; i++) {
      const k = kl[i];
      const b = i * colsPer;
      values.push(runId, symbol, new Date(k.closeTime), k.close, k.volume);
      chunks.push(`($${b+1},$${b+2},$${b+3},$${b+4},$${b+5})`);
    }
    const sql = `
      INSERT INTO ${shape.table} (run_id, ${shape.symCol}, ${shape.tsCol!}, ${shape.priceCol}, ${shape.volCol})
      VALUES ${chunks.join(",")}
      ON CONFLICT DO NOTHING
    `;
    await c.query(sql, values);
  }
}

// ---------------------- main ----------------------
export default async function runOnce() {
  const c = await pool.connect();
  try {
    const sid = await beginSession(c, `job:fetch_klines:${INTERVAL}`);
    log(`session`, sid);

    // learn table shape once per run
    const shape = await inspectSamples(c);
    log(`samples shape`, shape);

    for (const symbol of SYMBOLS) {
      try {
        // compute time window (no transaction)
        const lastTs = await lastKnownClose(c, shape, symbol);
        const since = lastTs ? lastTs + 1 : Date.now() - LOOKBACK_MS;

        const kl = await fetchKlines(symbol, INTERVAL, since, Date.now());
        if (!kl.length) { log(`[${symbol}] no klines`); continue; }

        // short write transaction
        await c.query("BEGIN");
        try {
          await insertKlines(c, sid, shape, symbol, kl);
          await c.query("COMMIT");
          log(`[${symbol}] ingested ${kl.length} klines (interval=${INTERVAL})`);
        } catch (e) {
          await c.query("ROLLBACK"); throw e;
        }
      } catch (e: any) {
        log(`[${symbol}] error:`, e?.message ?? e);
      }
    }

    await endSession(c, sid);
  } finally {
    c.release();
  }
}

if ((import.meta as any).main) {
  runOnce().catch(e => { console.error(e); process.exit(1); });
}
