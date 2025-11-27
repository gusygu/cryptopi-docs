// src/lib/str-aux/sessionDb.ts
 
import { Pool } from "pg";

export type WindowKey = "30m" | "1h" | "3h";

export type UpsertInput = {
  pair: { base: string; quote: string; window: WindowKey };
  appSessionId: string;

  // price & time
  ts_ms: number;
  price?: number;
  benchPct?: number;     // 100*(p/open - 1)
  pctDrv?: number;       // 100*(p_t/p_{t-1} - 1)
  pct24h?: number;

  // gfm
  gfm_r?: number;        // raw gfm in [0..1]
  gfm_delta?: number;    // fraction (e.g., +0.0123) NOT %
  eps_shift_pct?: number;  // optional override

  // bookkeeping overrides (rare)
  eta_pct?: number;
  k_cycles?: number;
};

export type SessionRow = {
  id: number;
  pair_base: string;
  pair_quote: string;
  window_key: WindowKey;
  app_session_id: string;

  opening_ts: number | null;
  opening_price: string | null;

  last_price: string | null;
  last_update_ms: number | null;
  bench_pct_min: number | null;
  bench_pct_max: number | null;
  price_min: string | null;
  price_max: string | null;

  eta_pct: number | null;
  eps_shift_pct: number | null;
  k_cycles: number | null;

  shifts: number;
  swaps: number;
  above_count: number;
  below_count: number;

  last_swap_ms: number | null;
  last_swap_dir: number | null;

  gfm_anchor_price: string | null;
  gfm_calc_price_last: string | null;
  gfm_r_last: number | null;
  gfm_delta_last: number | null;

  shift_stamp: boolean;
};

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 5,
  idleTimeoutMillis: 30_000,
});

async function fetchSession(
  base: string, quote: string, window: WindowKey, appSessionId: string
): Promise<SessionRow | null> {
  const q = `
    SELECT *
    FROM strategy_aux.str_aux_session
    WHERE pair_base=$1 AND pair_quote=$2 AND window_key=$3 AND app_session_id=$4
    LIMIT 1
  `;
  const r = await pool.query(q, [base, quote, window, appSessionId]);
  return r.rowCount ? (r.rows[0] as SessionRow) : null;
}

async function insertSession(base: string, quote: string, window: WindowKey, appSessionId: string) {
  const q = `
    INSERT INTO strategy_aux.str_aux_session
      (pair_base, pair_quote, window_key, app_session_id)
    VALUES ($1,$2,$3,$4)
    ON CONFLICT (pair_base, pair_quote, window_key, app_session_id) DO NOTHING
    RETURNING *;
  `;
  const r = await pool.query(q, [base, quote, window, appSessionId]);
  if (r.rowCount) return r.rows[0] as SessionRow;
  return fetchSession(base, quote, window, appSessionId);
}

type EventKind = "opening" | "swap" | "shift";
async function insertEvent(sessionId: number, kind: EventKind, payload: any, created_ms: number) {
  const q = `
    INSERT INTO strategy_aux.str_aux_event (session_id, kind, payload, created_ms)
    VALUES ($1,$2,$3,$4)
  `;
  await pool.query(q, [sessionId, kind, payload ?? {}, created_ms]);
}

/**
 * Core upsert that:
 *  - resumes above/below counters from DB (so no reset on reboot)
 *  - applies persistent shift rule: |deltaGFM_pct| > eps for >= 3 consecutive cycles
 *  - detects swaps on sign change of deltaGFM (fraction) and records last_swap_ms + last_swap_dir
 */
export async function upsertSession(input: UpsertInput) {
  const base = input.pair.base;
  const quote = input.pair.quote;
  const window = input.pair.window;
  const appSessionId = input.appSessionId;

  const ts = input.ts_ms;
  const price = input.price ?? null;
  const gfm_r = input.gfm_r ?? null;
  const gfm_delta = input.gfm_delta ?? null; // fraction, e.g., -0.0043

  // Load or create session row
  let row = await fetchSession(base, quote, window, appSessionId);
  if (!row) row = await insertSession(base, quote, window, appSessionId);
  if (!row) throw new Error("failed to upsert str_aux_session (no row)");

  // Use persisted epsilon unless override provided
  const eps = Math.abs(
    input.eps_shift_pct ?? row.eps_shift_pct ?? 0.20
  ); // in PERCENT terms
  const deltaPct = gfm_delta != null ? (gfm_delta * 100) : null; // convert to %

  // consecutive rule
  let above = row.above_count ?? 0;
  let below = row.below_count ?? 0;
  let shifts = row.shifts ?? 0;
  let swaps = row.swaps ?? 0;

  // swap detection (sign change of gfm_delta)
  const prevDelta = row.gfm_delta_last ?? null; // fraction
  let lastSwapMs = row.last_swap_ms ?? null;
  let lastSwapDir = row.last_swap_dir ?? null; // +1: +→-, -1: -→+

  if (prevDelta != null && gfm_delta != null && prevDelta !== 0) {
    const prevSign = prevDelta > 0 ? 1 : -1;
    const curSign = gfm_delta > 0 ? 1 : (gfm_delta < 0 ? -1 : 0);
    if (curSign !== 0 && curSign !== prevSign) {
      swaps += 1;
      lastSwapMs = ts;
      lastSwapDir = prevSign > 0 ? +1 : -1; // direction of transition
      await insertEvent(row.id, "swap", {
        at: ts, from: prevSign, to: curSign
      }, ts);
    }
  }

  // update consecutive counts
  if (deltaPct != null) {
    if (deltaPct > eps) {
      above += 1;
      below = 0;
    } else if (deltaPct < -eps) {
      below += 1;
      above = 0;
    } else {
      // inside band resets both
      above = 0;
      below = 0;
    }
  }

  // detect shift if either side reaches >= 3
  let shiftHappened = false;
  if (above >= 3 || below >= 3) {
    shifts += 1;
    shiftHappened = true;
    await insertEvent(row.id, "shift", {
      at: ts,
      deltaPct,
      side: above >= 3 ? "above" : "below",
      epsPct: eps,
      window,
    }, ts);

    // reset after shift confirmation
    above = 0;
    below = 0;
  }

  // track mins/maxes
  const price_min = row.price_min == null || (price != null && Number(price) < Number(row.price_min))
    ? price : row.price_min;
  const price_max = row.price_max == null || (price != null && Number(price) > Number(row.price_max))
    ? price : row.price_max;

  const benchPct = input.benchPct ?? null;
  const bench_pct_min = row.bench_pct_min == null || (benchPct != null && benchPct < row.bench_pct_min)
    ? benchPct : row.bench_pct_min;
  const bench_pct_max = row.bench_pct_max == null || (benchPct != null && benchPct > row.bench_pct_max)
    ? benchPct : row.bench_pct_max;

  // writeback
  const q = `
    UPDATE strategy_aux.str_aux_session SET
      last_price = COALESCE($1, last_price),
      last_update_ms = $2,
      price_min = COALESCE($3, price_min),
      price_max = COALESCE($4, price_max),
      bench_pct_min = COALESCE($5, bench_pct_min),
      bench_pct_max = COALESCE($6, bench_pct_max),

      eta_pct = COALESCE($7, eta_pct),
      eps_shift_pct = COALESCE($8, eps_shift_pct),
      k_cycles = COALESCE($9, k_cycles),

      shifts = $10,
      swaps = $11,
      above_count = $12,
      below_count = $13,

      last_swap_ms = $14,
      last_swap_dir = $15,

      gfm_calc_price_last = COALESCE($16, gfm_calc_price_last),
      gfm_r_last = COALESCE($17, gfm_r_last),
      gfm_delta_last = COALESCE($18, gfm_delta_last),

      shift_stamp = $19
    WHERE pair_base=$20 AND pair_quote=$21 AND window_key=$22 AND app_session_id=$23
    RETURNING *;
  `;

  const vals = [
    price,               // $1
    ts,                  // $2
    price_min,           // $3
    price_max,           // $4
    bench_pct_min,       // $5
    bench_pct_max,       // $6

    input.eta_pct ?? null,        // $7
    input.eps_shift_pct ?? null,  // $8
    input.k_cycles ?? null,       // $9

    shifts,              // $10
    swaps,               // $11
    above,               // $12
    below,               // $13

    lastSwapMs,          // $14
    lastSwapDir,         // $15

    price,               // $16 (gfm_calc_price_last) best effort
    gfm_r,               // $17
    gfm_delta,           // $18 (fraction)

    shiftHappened,       // $19
    base, quote, window, appSessionId // $20..$23
  ];

  const r = await pool.query(q, vals);
  return r.rows[0] as SessionRow;
}

export const sessionDb = { upsertSession };
export default sessionDb;
