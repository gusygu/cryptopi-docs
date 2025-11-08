BEGIN;

-- History table
CREATE TABLE IF NOT EXISTS public.dyn_matrix_values (
  ts_ms        BIGINT           NOT NULL,
  matrix_type  TEXT             NOT NULL CHECK (matrix_type IN ('benchmark','delta','pct24h','id_pct','pct_drv','ref','pct_ref')),
  base         TEXT             NOT NULL,
  quote        TEXT             NOT NULL,
  value        DOUBLE PRECISION NOT NULL,
  meta         JSONB            NOT NULL DEFAULT '{}'::jsonb,
  PRIMARY KEY (ts_ms, matrix_type, base, quote)
);
CREATE INDEX IF NOT EXISTS dyn_mv_idx_pair
  ON public.dyn_matrix_values (matrix_type, base, quote, ts_ms DESC);

-- Latest slice per matrix_type (prevents mixed-ts coloring)
CREATE OR REPLACE VIEW public.v_dyn_matrix_latest AS
WITH latest AS (
  SELECT matrix_type, MAX(ts_ms) AS ts
  FROM public.dyn_matrix_values
  GROUP BY matrix_type
)
SELECT d.*
FROM public.dyn_matrix_values d
JOIN latest l
  ON d.matrix_type = l.matrix_type
 AND d.ts_ms       = l.ts;

CREATE OR REPLACE VIEW public.v_dyn_matrix_latest_by_pair AS
SELECT matrix_type, base, quote, value, meta
FROM public.v_dyn_matrix_latest;

-- Writer with lightweight ledger
CREATE OR REPLACE FUNCTION public.upsert_dyn_matrix_value(
  p_ts_ms BIGINT, p_type TEXT, p_base TEXT, p_quote TEXT,
  p_value DOUBLE PRECISION, p_meta JSONB,
  p_session_id TEXT, p_idem TEXT
) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO public.dyn_matrix_values(ts_ms, matrix_type, base, quote, value, meta)
  VALUES (p_ts_ms, p_type, p_base, p_quote, p_value, COALESCE(p_meta,'{}'::jsonb))
  ON CONFLICT (ts_ms, matrix_type, base, quote)
  DO UPDATE SET value = EXCLUDED.value, meta = EXCLUDED.meta;

  INSERT INTO public.app_ledger(topic, event, payload, session_id, idempotency_key, ts_epoch_ms)
  VALUES ('matrices','upsert',
          jsonb_build_object('ts_ms',p_ts_ms,'type',p_type,'base',p_base,'quote',p_quote,'value',p_value),
          p_session_id, p_idem, p_ts_ms)
  ON CONFLICT (idempotency_key) DO NOTHING;
END$$;

-- Optional per-cycle doc helper (so your smoke can assert completeness)
CREATE OR REPLACE FUNCTION public.upsert_matrices_cycle_doc(
  p_app_session_id text,
  p_cycle_ts bigint,
  p_payload jsonb,
  p_pairs_count int DEFAULT NULL,
  p_rows_count int DEFAULT NULL,
  p_notes text DEFAULT NULL
) RETURNS void LANGUAGE sql AS $$
  INSERT INTO public.cycle_documents(domain, app_session_id, cycle_ts, payload, pairs_count, rows_count, notes)
  VALUES ('matrices', p_app_session_id, p_cycle_ts, COALESCE(p_payload,'{}'::jsonb), p_pairs_count, p_rows_count, p_notes)
  ON CONFLICT (domain, app_session_id, cycle_ts)
  DO UPDATE SET payload=EXCLUDED.payload, pairs_count=EXCLUDED.pairs_count, rows_count=EXCLUDED.rows_count, notes=EXCLUDED.notes, created_at=now();
$$;

COMMIT;
