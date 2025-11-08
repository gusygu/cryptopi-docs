BEGIN;

-- Schemas
CREATE SCHEMA IF NOT EXISTS public;
CREATE SCHEMA IF NOT EXISTS strategy_aux;

-- Root sessions
CREATE TABLE IF NOT EXISTS public.app_sessions (
  app_session_id text PRIMARY KEY,
  started_at     timestamptz NOT NULL DEFAULT now()
);

-- Basic refs (lightweight; extend anytime)
CREATE TABLE IF NOT EXISTS public.coins ( symbol text PRIMARY KEY );
CREATE TABLE IF NOT EXISTS public.pairs (
  base  text NOT NULL REFERENCES public.coins(symbol),
  quote text NOT NULL REFERENCES public.coins(symbol),
  PRIMARY KEY (base, quote)
);

-- Cycle clock for 30–60s ticks
CREATE TABLE IF NOT EXISTS public.cycles (
  cycle_ts   bigint PRIMARY KEY,        -- epoch ms
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Shared, low-friction app/system ledger
CREATE TABLE IF NOT EXISTS public.app_ledger (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  topic            text NOT NULL,      -- e.g. 'matrices','mea','cin','str','api'
  event            text NOT NULL,      -- e.g. 'upsert','opening_set','writer_ok'
  payload          jsonb,
  session_id       text,               -- app_session_id
  idempotency_key  text UNIQUE,        -- optional for dedupe
  ts_epoch_ms      bigint NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now()
);

-- Generic per-cycle audit “documents” for each domain
CREATE TABLE IF NOT EXISTS public.cycle_documents (
  domain           text        NOT NULL CHECK (domain IN ('matrices','mea','cin','str')),
  app_session_id   text        NOT NULL,
  cycle_ts         bigint      NOT NULL,
  payload          jsonb       NOT NULL,
  pairs_count      int,
  rows_count       int,
  notes            text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (domain, app_session_id, cycle_ts)
);
CREATE INDEX IF NOT EXISTS idx_cycle_documents_latest
  ON public.cycle_documents (domain, app_session_id, cycle_ts DESC);
CREATE INDEX IF NOT EXISTS idx_cycle_documents_payload_gin
  ON public.cycle_documents USING gin (payload);

CREATE OR REPLACE VIEW public.v_cycle_documents_latest AS
SELECT DISTINCT ON (domain, app_session_id)
       domain, app_session_id, cycle_ts, payload, created_at, pairs_count, rows_count, notes
FROM   public.cycle_documents
ORDER  BY domain, app_session_id, cycle_ts DESC;

-- Helpers
CREATE OR REPLACE FUNCTION public.ensure_app_session(p_app_session_id text)
RETURNS void LANGUAGE sql AS $$
  INSERT INTO public.app_sessions(app_session_id) VALUES (p_app_session_id)
  ON CONFLICT (app_session_id) DO NOTHING;
$$;

CREATE TABLE IF NOT EXISTS public.app_session_settings (
  app_session_id text PRIMARY KEY
    REFERENCES public.app_sessions(app_session_id) ON DELETE CASCADE,
  payload    jsonb       NOT NULL DEFAULT '{}'::jsonb,     -- full SSR/SCR, coins, windows, poller, etc.
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.app_session_settings_head (
  app_session_id   text PRIMARY KEY
    REFERENCES public.app_sessions(app_session_id) ON DELETE CASCADE,
  settings_applied boolean    NOT NULL DEFAULT false,
  applied_at       timestamptz,
  updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION public.upsert_app_session_settings(
  p_app_session_id text,
  p_payload jsonb
) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM public.ensure_app_session(p_app_session_id);
  INSERT INTO public.app_session_settings(app_session_id, payload)
  VALUES (p_app_session_id, COALESCE(p_payload,'{}'::jsonb))
  ON CONFLICT (app_session_id) DO UPDATE
    SET payload = EXCLUDED.payload, updated_at = now();
END$$;

CREATE OR REPLACE FUNCTION public.apply_session_settings(
  p_app_session_id text,
  p_payload jsonb,
  p_stamp boolean DEFAULT true
) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM public.ensure_app_session(p_app_session_id);

  INSERT INTO public.app_session_settings(app_session_id, payload)
  VALUES (p_app_session_id, COALESCE(p_payload,'{}'::jsonb))
  ON CONFLICT (app_session_id) DO UPDATE
    SET payload = EXCLUDED.payload, updated_at = now();

  INSERT INTO public.app_session_settings_head(app_session_id, settings_applied, applied_at)
  VALUES (p_app_session_id, p_stamp, CASE WHEN p_stamp THEN now() END)
  ON CONFLICT (app_session_id) DO UPDATE
    SET settings_applied = p_stamp,
        applied_at = CASE WHEN p_stamp THEN now() ELSE public.app_session_settings_head.applied_at END,
        updated_at = now();
END$$;

COMMIT;
