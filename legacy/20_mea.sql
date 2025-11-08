BEGIN;

-- Per-cycle pair orientation
CREATE TABLE IF NOT EXISTS public.mea_orientations (
  cycle_ts bigint NOT NULL REFERENCES public.cycles(cycle_ts),
  base     text   NOT NULL REFERENCES public.coins(symbol),
  quote    text   NOT NULL REFERENCES public.coins(symbol),
  metric   text   NOT NULL DEFAULT 'id_pct',
  value    double precision NOT NULL,
  PRIMARY KEY (cycle_ts, base, quote, metric)
);

-- Per-session snapshots (audit/replay)
CREATE TABLE IF NOT EXISTS public.mea_aux_snapshots (
  id             BIGSERIAL PRIMARY KEY,
  app_session_id TEXT   NOT NULL REFERENCES public.app_sessions(app_session_id) ON DELETE CASCADE,
  base           TEXT   NOT NULL REFERENCES public.coins(symbol),
  quote          TEXT   NOT NULL REFERENCES public.coins(symbol),
  window_key     TEXT   NOT NULL DEFAULT '1h',
  cycle_ts       BIGINT NOT NULL REFERENCES public.cycles(cycle_ts),
  payload        JSONB  NOT NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (app_session_id, base, quote, window_key, cycle_ts)
);
CREATE INDEX IF NOT EXISTS mea_aux_snapshots_lookup
  ON public.mea_aux_snapshots (app_session_id, base, quote, window_key, cycle_ts DESC);

CREATE OR REPLACE VIEW public.v_mea_aux_summary AS
SELECT base, quote, window_key, COUNT(*) AS samples, MAX(cycle_ts) AS last_cycle_ts
FROM public.mea_aux_snapshots
GROUP BY 1,2,3;

-- Cycle doc (MEA)
CREATE OR REPLACE FUNCTION public.upsert_mea_cycle_doc(
  p_app_session_id text,
  p_cycle_ts bigint,
  p_payload jsonb,
  p_pairs_count int DEFAULT NULL,
  p_rows_count int DEFAULT NULL,
  p_notes text DEFAULT NULL
) RETURNS void LANGUAGE sql AS $$
  INSERT INTO public.cycle_documents(domain, app_session_id, cycle_ts, payload, pairs_count, rows_count, notes)
  VALUES ('mea', p_app_session_id, p_cycle_ts, COALESCE(p_payload,'{}'::jsonb), p_pairs_count, p_rows_count, p_notes)
  ON CONFLICT (domain, app_session_id, cycle_ts)
  DO UPDATE SET payload=EXCLUDED.payload, pairs_count=EXCLUDED.pairs_count, rows_count=EXCLUDED.rows_count, notes=EXCLUDED.notes, created_at=now();
$$;

COMMIT;
