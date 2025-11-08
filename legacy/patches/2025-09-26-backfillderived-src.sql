-- Copy the primary src into derived rows at the same ts where it's missing.
WITH latest_ts AS (
  SELECT MAX(ts_ms) AS ts FROM public.dyn_matrix_values WHERE matrix_type = 'benchmark'
),
primary_src AS (
  SELECT ts_ms,
         COALESCE( (meta->>'src'), 'fallback' ) AS src
  FROM public.dyn_matrix_values
  WHERE matrix_type IN ('benchmark','delta','pct24h')
)
UPDATE public.dyn_matrix_values d
SET meta = COALESCE(d.meta, '{}'::jsonb) || jsonb_build_object('src', p.src)
FROM latest_ts lt
JOIN primary_src p ON p.ts_ms = lt.ts
WHERE d.ts_ms = lt.ts
  AND d.matrix_type IN ('id_pct','pct_drv','ref','pct_ref')
  AND (d.meta->>'src') IS NULL;
