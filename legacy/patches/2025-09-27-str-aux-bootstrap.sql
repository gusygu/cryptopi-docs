-- BOOTSTRAP: create str-aux tables if missing, then ensure gating columns, constraints, indexes, triggers.
-- Safe to run multiple times.

-- ───────────────────────────
-- 1) CREATE TABLES IF MISSING
-- ───────────────────────────

CREATE TABLE IF NOT EXISTS public.strategy_aux_sessions (
  app_session_id         text        NOT NULL,
  pair_base              text        NOT NULL,
  pair_quote             text        NOT NULL,
  window_key             text        NOT NULL,

  opening_price          double precision,
  price_min              double precision,
  price_max              double precision,
  bench_pct_min          double precision,
  bench_pct_max          double precision,

  gfm_ref_price          double precision,
  gfm_calc_price         double precision,

  epsilon_pct            double precision DEFAULT 0.0025,
  k_cycles               integer          DEFAULT 3,

  shifts                 integer          DEFAULT 0,
  swaps                  integer          DEFAULT 0,

  pending_shift_streak   integer          DEFAULT 0,
  pending_swap_streak    integer          DEFAULT 0,
  last_pct_drv_sign      smallint         DEFAULT 0,

  last_update_ms         bigint,

  created_at             timestamptz      NOT NULL DEFAULT now(),
  updated_at             timestamptz      NOT NULL DEFAULT now()
);

-- Unique key (idempotent)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM   pg_constraint
    WHERE  conname = 'strategy_aux_sessions_uniq'
  ) THEN
    ALTER TABLE public.strategy_aux_sessions
      ADD CONSTRAINT strategy_aux_sessions_uniq
      UNIQUE (app_session_id, pair_base, pair_quote, window_key);
  END IF;
END$$;

CREATE INDEX IF NOT EXISTS idx_str_aux_sessions_appsess ON public.strategy_aux_sessions (app_session_id);
CREATE INDEX IF NOT EXISTS idx_str_aux_sessions_last_ts ON public.strategy_aux_sessions (last_update_ms DESC);

-- Snapshots table used to hydrate "prev"
CREATE TABLE IF NOT EXISTS public.strategy_aux_snapshots (
  id             bigserial PRIMARY KEY,
  app_session_id text           NOT NULL,
  pair           text           NOT NULL,
  win            text,
  payload        jsonb          NOT NULL DEFAULT '{}'::jsonb,
  created_at     timestamptz    NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_str_aux_snaps_key
  ON public.strategy_aux_snapshots (app_session_id, pair, win, created_at DESC);

-- ────────────────────────────────
-- 2) ENSURE/ALTER MISSING COLUMNS
-- ────────────────────────────────

ALTER TABLE IF EXISTS public.strategy_aux_sessions
  ADD COLUMN IF NOT EXISTS gfm_ref_price        double precision,
  ADD COLUMN IF NOT EXISTS gfm_calc_price       double precision,
  ADD COLUMN IF NOT EXISTS epsilon_pct          double precision DEFAULT 0.0025,
  ADD COLUMN IF NOT EXISTS k_cycles             integer          DEFAULT 3,
  ADD COLUMN IF NOT EXISTS shifts               integer          DEFAULT 0,
  ADD COLUMN IF NOT EXISTS swaps                integer          DEFAULT 0,
  ADD COLUMN IF NOT EXISTS pending_shift_streak integer          DEFAULT 0,
  ADD COLUMN IF NOT EXISTS pending_swap_streak  integer          DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_pct_drv_sign    smallint         DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_update_ms       bigint,
  ADD COLUMN IF NOT EXISTS created_at           timestamptz      NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS updated_at           timestamptz      NOT NULL DEFAULT now();

-- Seed sensible defaults for existing rows (no-op if table was just created)
UPDATE public.strategy_aux_sessions s
SET
  gfm_ref_price        = COALESCE(s.gfm_ref_price, s.opening_price),
  epsilon_pct          = COALESCE(s.epsilon_pct, 0.0025),
  k_cycles             = COALESCE(s.k_cycles, 3),
  pending_shift_streak = COALESCE(s.pending_shift_streak, 0),
  pending_swap_streak  = COALESCE(s.pending_swap_streak, 0),
  last_pct_drv_sign    = COALESCE(s.last_pct_drv_sign, 0)
WHERE TRUE;

-- ─────────────────────────────
-- 3) TOUCH updated_at ON UPDATE
-- ─────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'fn_touch_updated_at') THEN
    CREATE OR REPLACE FUNCTION public.fn_touch_updated_at()
    RETURNS trigger LANGUAGE plpgsql AS $f$
    BEGIN
      NEW.updated_at := now();
      RETURN NEW;
    END;$f$;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_str_aux_sessions_updated_at') THEN
    CREATE TRIGGER trg_str_aux_sessions_updated_at
      BEFORE UPDATE ON public.strategy_aux_sessions
      FOR EACH ROW EXECUTE FUNCTION public.fn_touch_updated_at();
  END IF;
END$$;
