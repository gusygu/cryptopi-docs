-- job_str_synthetic_cycle.sql
BEGIN;
WITH r AS (
  INSERT INTO str_aux.vectors_run (run_id, ts, window_key, bins)
  VALUES (gen_random_uuid(), now(), '1h', 48)
  RETURNING run_id
)
INSERT INTO str_aux.vectors_symbol(run_id, symbol, v_inner, v_outer, spread, v_tendency, v_swap, summary)
SELECT run_id, cu.symbol, 0.1, 0.2, 0.05, 0.01, 0.02, '{}'::jsonb
FROM r CROSS JOIN LATERAL (
  SELECT symbol FROM settings.coin_universe WHERE enabled
) cu;
COMMIT;
