// src/core/features/cin-aux/cinetics.ts
import { db } from "@/core/db/db";

/** ---------- compute (keep pure) ---------- */
export type CinMetrics = {
  throughput?: number;   // units/s (or legs/sec)
  latencyMs?: number;    // ms
  efficiency?: number;   // 0..1
};

function numOrUndef(x: any): number | undefined {
  const n = Number(x);
  return Number.isFinite(n) ? n : undefined;
}

/** Pure mapper from a generic ctx into CinMetrics. */
export function computeCinMetrics(ctx: any): CinMetrics {
  return {
    throughput: numOrUndef(ctx?.throughput),
    latencyMs:  numOrUndef(ctx?.latencyMs),
    efficiency: numOrUndef(ctx?.efficiency),
  };
}

/** ---------- optional: rollups from cycle rows ---------- */
export type CinAuxRow = {
  appSessionId: string;
  cycleTs: number;
  symbol: string;
  walletUsdt: number;
  profitUsdt: number;           // realized if ledger available, else expected
  imprintCycleUsdt: number;     // residual inflow - outflow (>=0)
  luggageCycleUsdt: number;     // realized - expected
};

/** Aggregate a batch of CinAux rows into metrics. */
export function aggregateCinFromRows(rows: CinAuxRow[]): CinMetrics {
  if (!rows?.length) return {};
  const sum = (k: keyof CinAuxRow) => rows.reduce((a, r) => a + (Number(r[k]) || 0), 0);
  const totalProfit = sum("profitUsdt");
  const imprint     = sum("imprintCycleUsdt");
  const luggageAbs  = rows.reduce((a, r) => a + Math.abs(Number(r.luggageCycleUsdt) || 0), 0);

  // simple efficiency: profit vs (imprint + |luggage|)
  const denom = imprint + luggageAbs;
  const efficiency = denom > 0 ? totalProfit / denom : undefined;

  // rough “throughput”: non-zero symbols per cycle second (tunable)
  const active = rows.filter(r => (r.walletUsdt || 0) > 0).length;
  const throughput = active; // you can divide by period seconds if you pass it in

  return { efficiency, throughput };
}

/** ---------- matrix (client-facing) ---------- */
export type CinRow = { key: string; value: number | string | null };

export function buildCinMatrix(m: CinMetrics): CinRow[] {
  return [
    { key: "throughput", value: m.throughput ?? null },
    { key: "latencyMs",  value: m.latencyMs ?? null },
    { key: "efficiency", value: m.efficiency ?? null },
  ];
}

/** ---------- register (persist) ---------- */
export async function saveCinMetrics(appSessionId: string | null | undefined, ts_ms: number, m: CinMetrics) {
  try {
    await db.query(
      `INSERT INTO cin_metrics (app_session_id, ts_ms, payload)
       VALUES ($1,$2,$3)
       ON CONFLICT (app_session_id, ts_ms) DO UPDATE SET payload=EXCLUDED.payload`,
      [appSessionId ?? null, ts_ms, JSON.stringify(m)]
    );
  } catch { /* optional table — ok during scaffolding */ }
}
