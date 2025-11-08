BEGIN;

-- Canonical STR session row per (pair, window, app_session)
-- (Assumes your existing table; this index is safe to (re)create)
CREATE INDEX IF NOT EXISTS idx_str_aux_session_lookup
  ON strategy_aux.str_aux_session (pair_base, pair_quote, window_key, app_session_id);

-- Events (opening | swap | shift)
CREATE TABLE IF NOT EXISTS strategy_aux.str_aux_event (
  id           BIGSERIAL PRIMARY KEY,
  session_id   BIGINT NOT NULL REFERENCES strategy_aux.str_aux_session(id) ON DELETE CASCADE,
  kind         TEXT NOT NULL,             -- 'opening' | 'swap' | 'shift'
  payload      JSONB,
  created_ms   BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_str_aux_event_session
  ON strategy_aux.str_aux_event (session_id, created_ms DESC);

-- Opening upsert (resets counters & GFM anchors; logs to app_ledger)
CREATE OR REPLACE FUNCTION public.upsert_str_aux_opening(
  p_base TEXT, p_quote TEXT, p_window TEXT, p_app_session_id TEXT,
  p_opening_ts BIGINT, p_opening_price DOUBLE PRECISION,
  p_idem TEXT
) RETURNS BIGINT AS $$
DECLARE v_id BIGINT;
BEGIN
  PERFORM public.ensure_app_session(p_app_session_id);

  INSERT INTO strategy_aux.str_aux_session(
    pair_base, pair_quote, window_key, app_session_id,
    opening_stamp, opening_ts, opening_price,
    price_min, price_max, bench_pct_min, bench_pct_max,
    last_update_ms,
    -- resets
    shifts, swaps, ui_epoch, above_count, below_count, shift_stamp,
    -- GFM anchors
    gfm_anchor_price, gfm_calc_price_last, gfm_r_last, gfm_delta_last,
    -- last price
    last_price
  ) VALUES (
    p_base, COALESCE(p_quote,'USDT'), p_window, p_app_session_id,
    TRUE, p_opening_ts, p_opening_price,
    p_opening_price, p_opening_price, 0, 0,
    p_opening_ts,
    0, 0, 0, 0, 0, FALSE,
    p_opening_price, NULL, NULL, NULL,
    p_opening_price
  )
  ON CONFLICT (pair_base, pair_quote, window_key, app_session_id)
  DO UPDATE SET
    opening_stamp  = TRUE,
    opening_ts     = EXCLUDED.opening_ts,
    opening_price  = EXCLUDED.opening_price,
    price_min      = EXCLUDED.opening_price,
    price_max      = EXCLUDED.opening_price,
    bench_pct_min  = 0,
    bench_pct_max  = 0,
    last_update_ms = EXCLUDED.last_update_ms,
    shifts         = 0, swaps = 0, ui_epoch = 0,
    above_count    = 0, below_count = 0, shift_stamp = FALSE,
    gfm_anchor_price    = EXCLUDED.opening_price,
    gfm_calc_price_last = NULL,
    gfm_r_last          = NULL,
    gfm_delta_last      = NULL,
    last_price          = EXCLUDED.opening_price
  RETURNING id INTO v_id;

  INSERT INTO public.app_ledger(topic, event, payload, session_id, idempotency_key, ts_epoch_ms)
  VALUES ('str','opening_set',
          jsonb_build_object('str_session_id',v_id,'base',p_base,'quote',p_quote,'window',p_window,
                             'opening_ts',p_opening_ts,'opening_price',p_opening_price),
          p_app_session_id, p_idem, p_opening_ts)
  ON CONFLICT (idempotency_key) DO NOTHING;

  RETURN v_id;
END;
$$ LANGUAGE plpgsql;

-- Cycle doc (STR)
CREATE OR REPLACE FUNCTION public.upsert_str_cycle_doc(
  p_app_session_id text,
  p_cycle_ts bigint,
  p_payload jsonb,
  p_pairs_count int DEFAULT NULL,
  p_rows_count int DEFAULT NULL,
  p_notes text DEFAULT NULL
) RETURNS void LANGUAGE sql AS $$
  INSERT INTO public.cycle_documents(domain, app_session_id, cycle_ts, payload, pairs_count, rows_count, notes)
  VALUES ('str', p_app_session_id, p_cycle_ts, COALESCE(p_payload,'{}'::jsonb), p_pairs_count, p_rows_count, p_notes)
  ON CONFLICT (domain, app_session_id, cycle_ts)
  DO UPDATE SET payload=EXCLUDED.payload, pairs_count=EXCLUDED.pairs_count, rows_count=EXCLUDED.rows_count, notes=EXCLUDED.notes, created_at=now();
$$;

COMMIT;
