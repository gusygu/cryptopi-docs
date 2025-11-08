// src/core/features/mea-aux/measures.ts
import { db } from "@/core/db/db";

export { buildMeaAux, buildMeaAuxForCycle, toRenderableRows } from "./grid";
export type { IdPctGrid, BalancesMap, MeaAuxGrid, MeaPair, MeaRow } from "./grid";

/** ---------- retrieval: generic metric fetchers ---------- */
export async function getMetric(metricKey: string, ts_ms: number): Promise<number | null> {
  try {
    const { rows } = await db.query<{ value: number }>(
      `SELECT value FROM metrics
       WHERE metric_key=$1 AND ts_epoch_ms <= $2
       ORDER BY ts_epoch_ms DESC
       LIMIT 1`,
      [metricKey, ts_ms]
    );
    return rows.length ? Number(rows[0].value) : null;
  } catch { return null; }
}

export async function getManyMetrics(keys: string[], ts_ms: number): Promise<Record<string, number | null>> {
  const out: Record<string, number | null> = {};
  await Promise.all(keys.map(async (k) => { out[k] = await getMetric(k, ts_ms); }));
  return out;
}

/** ---------- calc: assemble mood inputs ---------- */
export type MoodInputs = {
  GFMdelta: number | null;
  vSwap:    number | null;
  Inertia:  number | null;
  Disrupt:  number | null;
  Amp:      number | null;
  Volt:     number | null;
  id_pct?:  number | null;
};

export async function assembleMoodInputs(ts_ms: number): Promise<MoodInputs> {
  const keys = ["GFMdelta","vSwap","Inertia","Disruption","Amp","Volt","id_pct:global"];
  const got  = await getManyMetrics(keys, ts_ms);
  return {
    GFMdelta: got["GFMdelta"],
    vSwap:    got["vSwap"],
    Inertia:  got["Inertia"],
    Disrupt:  got["Disruption"],
    Amp:      got["Amp"],
    Volt:     got["Volt"],
    id_pct:   got["id_pct:global"],
  };
}

/** ---------- register (persist) ---------- */
export async function saveMoodObservation(appSessionId: string, ts_ms: number, moodLabel: string, weight: number | null, payload: unknown) {
  try {
    await db.query(
      `INSERT INTO mea_mood_observations (app_session_id, ts_ms, mn_label, weight, payload)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (app_session_id, ts_ms) DO UPDATE
       SET mn_label=EXCLUDED.mn_label, weight=EXCLUDED.weight, payload=EXCLUDED.payload`,
      [appSessionId, ts_ms, moodLabel, weight ?? null, JSON.stringify(payload ?? null)]
    );
  } catch { /* optional table */ }
}

// PATCH: src/core/features/mea-aux/measures.ts
import { computeMoodCoeffV1 } from "./mood-formula";

export async function computeMoodCoeffUsingCurrentMetrics(ts_ms: number): Promise<{
  coeff: number; buckets: { vTendencyIdx: number; GFMIdx: number; vSwapIdx: number };
}> {
  const m = await assembleMoodInputs(ts_ms); // already exists
  const { coeff, buckets } = computeMoodCoeffV1({
    vTendency: m.Inertia ?? m.id_pct ?? 0, // if you map vTendency elsewhere, adjust here
    GFM: (m.GFMdelta ?? 0) + 1,            // if your GFMdelta is delta vs 1.0, shift into [0.8..1.2]
    vSwap: m.vSwap ?? 0,
  });
  return { coeff, buckets };
}
