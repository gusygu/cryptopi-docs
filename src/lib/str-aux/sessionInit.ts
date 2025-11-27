// src/lib/str-aux/sessionInit.ts
 
import { Pool } from 'pg';

export type WindowKey = '30m' | '1h' | '3h';

const pool = new Pool({
  connectionString:
    process.env.DATABASE_URL ||
    process.env.POSTGRES_URL ||
    undefined,
  ssl:
    process.env.PGSSL === 'disable'
      ? false
      : (process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false),
});

type EnsureArgs = {
  base: string;
  quote: string;
  window: WindowKey;
  appSessionId: string;

  openingTs: number;
  openingPrice: number;

  // initial min/max anchors (NOT NULL in schema)
  priceMin: number;
  priceMax: number;
  benchPctMin: number;
  benchPctMax: number;

  eps_shift_pct?: number | null;
  k_cycles?: number | null;
};

/**
 * Ensure one row exists with the mandatory NOT NULL fields set.
 * Safe to call every tick (ON CONFLICT DO NOTHING).
 */
export async function ensureSession(a: EnsureArgs): Promise<void> {
  const q = `
    INSERT INTO strategy_aux.str_aux_session
      (pair_base, pair_quote, window_key, app_session_id,
       opening_ts, opening_price,
       price_min, price_max, bench_pct_min, bench_pct_max,
       eps_shift_pct, k_cycles)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
    ON CONFLICT (pair_base, pair_quote, window_key, app_session_id) DO NOTHING;
  `;

  const vals = [
    a.base, a.quote, a.window, a.appSessionId,
    Number(a.openingTs), String(a.openingPrice),
    String(a.priceMin), String(a.priceMax),
    String(a.benchPctMin), String(a.benchPctMax),
    a.eps_shift_pct ?? null, a.k_cycles ?? null,
  ];

  try {
    await pool.query(q, vals);
  } catch (e: any) {
    console.error('[ensureSession] insert failed:', e?.message ?? e);
    throw e;
  }
}
