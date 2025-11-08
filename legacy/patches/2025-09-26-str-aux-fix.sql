-- src/core/db/patches/2025-09-26-str-aux-fix.sql
-- Idempotent: only adds eta_pct if table exists AND column is missing.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'str_aux_session'
  ) THEN
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'str_aux_session' AND column_name = 'eta_pct'
    ) THEN
      ALTER TABLE public.str_aux_session
        ADD COLUMN eta_pct double precision;
    END IF;
  END IF;
END$$;
