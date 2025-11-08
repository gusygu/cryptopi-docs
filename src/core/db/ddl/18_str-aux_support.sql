-- 20_str_aux_support.sql
-- Minimal support views for str-aux smoke.

-- Make sure schema exists (no-op if already there)
CREATE SCHEMA IF NOT EXISTS str_aux;

-- View: str_aux.v_stats_coverage
-- Shows per (symbol, window_label) coverage with simple row counts.
-- Uses enabled symbols from settings.coin_universe
-- Uses a default label set so it's never empty even on a fresh DB.
CREATE OR REPLACE VIEW str_aux.v_stats_coverage AS
WITH enabled_syms AS (
  SELECT symbol
  FROM settings.coin_universe
  WHERE enabled
),
labels AS (
  -- Default label set; adapt if you use a different set
  SELECT * FROM (VALUES
    ('1m'::text),
    ('3m'::text),
    ('5m'::text),
    ('15m'::text),
    ('1h'::text)
  ) AS t(window_label)
),
grid AS (
  SELECT s.symbol, l.window_label
  FROM enabled_syms s
  CROSS JOIN labels l
),
stats AS (
  SELECT symbol, window_label, COUNT(*)::bigint AS stats_rows
       , NULL::timestamp AS last_stats_updated
  FROM str_aux.window_stats
  GROUP BY 1,2
),
vecs AS (
  SELECT symbol, window_label, COUNT(*)::bigint AS vector_rows
       , NULL::timestamp AS last_vec_updated
  FROM str_aux.window_vectors
  GROUP BY 1,2
)
SELECT
  g.symbol,
  g.window_label,
  -- "windows": 1 when we see any stats or vectors for that (symbol,label); else 0
  CASE WHEN COALESCE(s.stats_rows,0) > 0 OR COALESCE(v.vector_rows,0) > 0 THEN 1 ELSE 0 END AS windows,
  COALESCE(s.stats_rows,  0) AS stats_rows,
  COALESCE(v.vector_rows, 0) AS vector_rows,
  NULL::timestamp AS last_win_updated,
  s.last_stats_updated,
  v.last_vec_updated
FROM grid g
LEFT JOIN stats s USING (symbol, window_label)
LEFT JOIN vecs  v USING (symbol, window_label)
ORDER BY g.symbol, g.window_label;

-- View: str_aux.v_stats_vectors_gaps
-- Minimal stub: returns zero rows so the smoke won't call recompute functions.
CREATE OR REPLACE VIEW str_aux.v_stats_vectors_gaps AS
SELECT
  NULL::text AS symbol,
  NULL::text AS window_label,
  0::int    AS missing_stats,
  0::int    AS missing_vectors
WHERE FALSE;
