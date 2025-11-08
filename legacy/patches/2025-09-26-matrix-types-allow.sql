-- widen matrix_type check to include all we write now:
-- benchmark, delta, pct24h, id_pct, pct_drv, pct_ref, ref
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM   pg_constraint
    WHERE  conname = 'dyn_matrix_values_matrix_type_check'
  ) THEN
    ALTER TABLE public.dyn_matrix_values
      DROP CONSTRAINT dyn_matrix_values_matrix_type_check;
  END IF;

  ALTER TABLE public.dyn_matrix_values
    ADD CONSTRAINT dyn_matrix_values_matrix_type_check
    CHECK (matrix_type IN (
      'benchmark','delta','pct24h','id_pct','pct_drv','pct_ref','ref'
    ));
END$$;
