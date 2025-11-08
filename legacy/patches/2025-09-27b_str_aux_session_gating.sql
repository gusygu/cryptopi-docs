-- Add/ensure gating fields & seed defaults; use IF EXISTS to be safe

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
  ADD COLUMN IF NOT EXISTS last_update_ms       bigint;

-- Seed sensible defaults for existing rows
UPDATE public.strategy_aux_sessions s
SET
  gfm_ref_price        = COALESCE(s.gfm_ref_price, s.opening_price),
  epsilon_pct          = COALESCE(s.epsilon_pct, 0.0025),
  k_cycles             = COALESCE(s.k_cycles, 3),
  pending_shift_streak = COALESCE(s.pending_shift_streak, 0),
  pending_swap_streak  = COALESCE(s.pending_swap_streak, 0),
  last_pct_drv_sign    = COALESCE(s.last_pct_drv_sign, 0)
WHERE TRUE;

-- Touch updated_at on write (optional, simple trigger)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'trg_str_aux_sessions_updated_at'
  ) THEN
    CREATE OR REPLACE FUNCTION public.fn_touch_updated_at()
    RETURNS trigger LANGUAGE plpgsql AS $f$
    BEGIN
      NEW.updated_at := now();
      RETURN NEW;
    END;$f$;

    CREATE TRIGGER trg_str_aux_sessions_updated_at
      BEFORE UPDATE ON public.strategy_aux_sessions
      FOR EACH ROW EXECUTE FUNCTION public.fn_touch_updated_at();
  END IF;
END$$;
