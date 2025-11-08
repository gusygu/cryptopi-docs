BEGIN;

CREATE TABLE IF NOT EXISTS public.cin_aux_cycle (
  app_session_id        text   NOT NULL REFERENCES public.app_sessions(app_session_id),
  cycle_ts              bigint NOT NULL REFERENCES public.cycles(cycle_ts),
  symbol                text   NOT NULL REFERENCES public.coins(symbol),
  wallet_usdt           double precision NOT NULL,
  profit_usdt           double precision NOT NULL DEFAULT 0,
  imprint_cycle_usdt    double precision NOT NULL DEFAULT 0,
  luggage_cycle_usdt    double precision NOT NULL DEFAULT 0,
  PRIMARY KEY (app_session_id, cycle_ts, symbol)
);
CREATE INDEX IF NOT EXISTS idx_cin_aux_cycle_session_ts
  ON public.cin_aux_cycle (app_session_id, cycle_ts DESC);

CREATE TABLE IF NOT EXISTS public.cin_aux_session_acc (
  app_session_id     text NOT NULL REFERENCES public.app_sessions(app_session_id),
  symbol             text NOT NULL REFERENCES public.coins(symbol),
  imprint_acc_usdt   double precision NOT NULL DEFAULT 0,
  luggage_acc_usdt   double precision NOT NULL DEFAULT 0,
  PRIMARY KEY (app_session_id, symbol)
);

CREATE OR REPLACE VIEW public.v_cin_aux AS
SELECT
  c.app_session_id, c.cycle_ts, c.symbol, c.wallet_usdt, c.profit_usdt,
  c.imprint_cycle_usdt, c.luggage_cycle_usdt,
  COALESCE(a.imprint_acc_usdt, 0) AS imprint_app_session_usdt,
  COALESCE(a.luggage_acc_usdt, 0) AS luggage_app_session_usdt
FROM public.cin_aux_cycle c
LEFT JOIN public.cin_aux_session_acc a
  ON a.app_session_id = c.app_session_id
 AND a.symbol        = c.symbol;

-- Cycle doc (CIN)
CREATE OR REPLACE FUNCTION public.upsert_cin_cycle_doc(
  p_app_session_id text,
  p_cycle_ts bigint,
  p_payload jsonb,
  p_pairs_count int DEFAULT NULL,
  p_rows_count int DEFAULT NULL,
  p_notes text DEFAULT NULL
) RETURNS void LANGUAGE sql AS $$
  INSERT INTO public.cycle_documents(domain, app_session_id, cycle_ts, payload, pairs_count, rows_count, notes)
  VALUES ('cin', p_app_session_id, p_cycle_ts, COALESCE(p_payload,'{}'::jsonb), p_pairs_count, p_rows_count, p_notes)
  ON CONFLICT (domain, app_session_id, cycle_ts)
  DO UPDATE SET payload=EXCLUDED.payload, pairs_count=EXCLUDED.pairs_count, rows_count=EXCLUDED.rows_count, notes=EXCLUDED.notes, created_at=now();
$$;

COMMIT;
