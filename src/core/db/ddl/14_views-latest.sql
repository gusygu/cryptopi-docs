BEGIN;

-- ──────────────────────────────────────────────────────────────────────────────
-- 14_views-latest.sql — safe with str_aux tables present
-- ──────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION str_aux._has_col(sch text, rel text, col text)
RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = sch AND table_name = rel AND column_name = col
  );
$$;

-- === VECTORS_LATEST (from str_aux.vectors table)
DO $$
BEGIN
  IF to_regclass('str_aux.vectors') IS NOT NULL THEN
    EXECUTE $SQL$
      CREATE OR REPLACE VIEW str_aux.vectors_latest AS
      SELECT DISTINCT ON (symbol, win)
             symbol, win, ts, vec
      FROM str_aux.vectors
      ORDER BY symbol, win, ts DESC
    $SQL$;
  END IF;
END $$;

-- === STATS_LATEST (from str_aux.stats table)
DO $$
BEGIN
  IF to_regclass('str_aux.stats') IS NOT NULL THEN
    EXECUTE $SQL$
      CREATE OR REPLACE VIEW str_aux.stats_latest AS
      SELECT DISTINCT ON (symbol, win)
             symbol, win, ts, mid, ret_close_1, ret_close_3
      FROM str_aux.stats
      ORDER BY symbol, win, ts DESC
    $SQL$;
  END IF;
END $$;

-- === SAMPLES_LATEST (only if samples tables exist)
DO $$
BEGIN
  IF to_regclass('str_aux.samples_symbol') IS NOT NULL
     AND to_regclass('str_aux.samples_run') IS NOT NULL THEN
    EXECUTE $SQL$
      CREATE OR REPLACE VIEW str_aux.samples_latest AS
      SELECT DISTINCT ON (ss.symbol)
             ss.symbol, sr.ts, ss.ok, ss.cycle, ss.windows,
             ss.last_point, ss.last_closed_mark,
             ss.history_size, ss.error, sr.run_id
      FROM str_aux.samples_symbol ss
      JOIN str_aux.samples_run sr USING (run_id)
      ORDER BY ss.symbol, sr.ts DESC, sr.run_id DESC
    $SQL$;
  END IF;
END $$;

-- === Optional cross-module window_panel_latest
DO $$
BEGIN
  IF to_regclass('str_aux.vectors_latest') IS NOT NULL
     AND to_regclass('mea_dynamics.dynamics_latest') IS NOT NULL THEN
    EXECUTE $SQL$
      CREATE OR REPLACE VIEW str_aux.window_panel_latest AS
      SELECT
        dl.window_label,
        dl.engine_cycle,
        dl.ts AS window_ts,
        dl.base,
        dl.quote,
        vl.symbol,
        vl.vec[1] AS v_inner,
        vl.vec[2] AS v_outer,
        vl.vec[3] AS v_spread,
        dl.mea_value,
        dl.mea_tier,
        dl.mood_id,
        dl.mood_name
      FROM mea_dynamics.dynamics_latest dl
      LEFT JOIN str_aux.vectors_latest vl
        ON vl.symbol IN (dl.base, dl.quote)
    $SQL$;
  END IF;
END $$;

COMMIT;
