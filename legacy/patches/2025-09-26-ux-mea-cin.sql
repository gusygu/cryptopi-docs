-- Ensure MEA has the arbiter for ON CONFLICT (cycle_ts, base, quote)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname='public' AND indexname='ux_mea_orientations_cycle_base_quote'
  ) THEN
    CREATE UNIQUE INDEX ux_mea_orientations_cycle_base_quote
      ON public.mea_orientations (cycle_ts, base, quote);
  END IF;
END$$;

-- Ensure CIN has the arbiter for ON CONFLICT (app_session_id, cycle_ts, symbol)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname='public' AND indexname='ux_cin_aux_cycle_session_ts_symbol'
  ) THEN
    CREATE UNIQUE INDEX ux_cin_aux_cycle_session_ts_symbol
      ON public.cin_aux_cycle (app_session_id, cycle_ts, symbol);
  END IF;
END$$;
