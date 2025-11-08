-- 19_debug.sql  —  Diagnostics & Reactive Universe (final)
-- Runs last; safe even when str_aux is missing.

--------------------------------------------------------------------------------
-- SCHEMA
--------------------------------------------------------------------------------
CREATE SCHEMA IF NOT EXISTS debug;

--------------------------------------------------------------------------------
-- 0. SAFE ALIASES FOR MARKET SOURCES
--------------------------------------------------------------------------------

-- Orderbook (empty stub if absent)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='market' AND c.relname='orderbook_snapshots'
  ) THEN
    EXECUTE $v$
      CREATE OR REPLACE VIEW debug._ob_src AS
      SELECT symbol::text AS symbol, ts::timestamptz AS ts
      FROM market.orderbook_snapshots
    $v$;
  ELSE
    EXECUTE 'CREATE OR REPLACE VIEW debug._ob_src AS SELECT NULL::text AS symbol, NULL::timestamptz AS ts WHERE false';
  END IF;
END $$;

-- Klines normalized (matches your schema)
CREATE OR REPLACE VIEW debug._klines_win AS
SELECT
  k.symbol::text           AS symbol,
  k.open_time::timestamptz AS ts,
  k.window_label::text     AS win
FROM market.klines k;

--------------------------------------------------------------------------------
-- 1. SETTINGS-FIRST UNIVERSE
--------------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema='settings' AND table_name='coin_universe'
  ) THEN
    EXECUTE $v$ CREATE OR REPLACE VIEW debug.universe AS
      SELECT DISTINCT
             COALESCE(NULLIF(symbol::text,''),
                      CASE WHEN base IS NOT NULL AND quote IS NOT NULL THEN base||quote END) AS symbol
      FROM settings.coin_universe
      WHERE COALESCE(enabled,true)=true $v$;
  ELSE
    EXECUTE $v$ CREATE OR REPLACE VIEW debug.universe AS
      SELECT DISTINCT symbol::text AS symbol FROM market.klines $v$;
  END IF;
END $$;

--------------------------------------------------------------------------------
-- 2. STR_AUX TABLE SAFETY
--------------------------------------------------------------------------------
CREATE SCHEMA IF NOT EXISTS str_aux;

CREATE TABLE IF NOT EXISTS str_aux.stats(
  symbol text NOT NULL,
  win    text NOT NULL,
  ts     timestamptz NOT NULL,
  mid            double precision,
  ret_close_1    double precision,
  ret_close_3    double precision,
  PRIMARY KEY (symbol, win, ts)
);

CREATE TABLE IF NOT EXISTS str_aux.vectors(
  symbol text NOT NULL,
  win    text NOT NULL,
  ts     timestamptz NOT NULL,
  vec    double precision[] NOT NULL,
  PRIMARY KEY (symbol, win, ts)
);

--------------------------------------------------------------------------------
-- 3. RECOMPUTE FUNCTIONS  (deduplicated INSERTs)
--------------------------------------------------------------------------------
DROP FUNCTION IF EXISTS str_aux.recompute_window_stats(text,text);
DROP FUNCTION IF EXISTS str_aux.recompute_window_vectors(text,text);

CREATE OR REPLACE FUNCTION str_aux.recompute_window_stats(p_symbol text, p_win text)
RETURNS int
LANGUAGE sql AS $$
WITH k AS (
  SELECT
    k.open_time                                AS ts,
    k.close_price::double precision            AS close_px,
    LAG(k.close_price::double precision)
      OVER (ORDER BY k.open_time)              AS prev_close
  FROM market.klines k
  WHERE k.symbol = p_symbol
    AND k.window_label = p_win
),
calc AS (
  SELECT
    ts,
    close_px                                   AS mid,
    CASE WHEN prev_close IS NULL OR prev_close=0
         THEN NULL
         ELSE (close_px/prev_close - 1.0) END  AS ret_close_1,
    (EXP(SUM(LN(1.0 + COALESCE(
          CASE WHEN prev_close IS NULL OR prev_close=0
               THEN NULL
               ELSE (close_px/prev_close - 1.0) END, 0)))
       OVER (ORDER BY ts ROWS BETWEEN 2 PRECEDING AND CURRENT ROW)) - 1.0) AS ret_close_3
  FROM k
),
dedup AS (
  SELECT DISTINCT ON (p_symbol, p_win, ts)
         p_symbol AS symbol, p_win AS win, ts, mid, ret_close_1, ret_close_3
  FROM calc
  ORDER BY p_symbol, p_win, ts
)
INSERT INTO str_aux.stats(symbol, win, ts, mid, ret_close_1, ret_close_3)
SELECT symbol, win, ts, mid, ret_close_1, ret_close_3
FROM dedup
ON CONFLICT (symbol, win, ts) DO UPDATE
SET mid=EXCLUDED.mid,
    ret_close_1=EXCLUDED.ret_close_1,
    ret_close_3=EXCLUDED.ret_close_3
RETURNING 1;
$$;

CREATE OR REPLACE FUNCTION str_aux.recompute_window_vectors(p_symbol text, p_win text)
RETURNS int
LANGUAGE sql AS $$
INSERT INTO str_aux.vectors(symbol, win, ts, vec)
SELECT s.symbol, s.win, s.ts,
       ARRAY[
         COALESCE(s.mid,0),
         COALESCE(s.ret_close_1,0),
         COALESCE(s.ret_close_3,0)
       ]::double precision[]
FROM str_aux.stats s
WHERE s.symbol = p_symbol AND s.win = p_win
ON CONFLICT (symbol, win, ts) DO UPDATE
SET vec = EXCLUDED.vec
RETURNING 1;
$$;

--------------------------------------------------------------------------------
-- 4. COVERAGE + GAPS DIAGNOSTICS
--------------------------------------------------------------------------------
CREATE OR REPLACE VIEW debug.source_coverage AS
SELECT u.symbol,
       kl.win,
       COUNT(kl.*) FILTER (WHERE kl.ts IS NOT NULL) AS kline_rows,
       COUNT(ob.*) FILTER (WHERE ob.ts IS NOT NULL) AS ob_rows
FROM debug.universe u
LEFT JOIN debug._klines_win kl ON kl.symbol = u.symbol
LEFT JOIN debug._ob_src     ob ON ob.symbol = u.symbol
GROUP BY 1,2
ORDER BY 1,2;

CREATE OR REPLACE VIEW debug.straux_coverage AS
SELECT u.symbol,
       st.win,
       COUNT(st.*) AS stats_rows,
       COUNT(v.*)  FILTER (WHERE v.ts IS NOT NULL) AS vector_rows
FROM debug.universe u
LEFT JOIN str_aux.stats   st ON st.symbol = u.symbol
LEFT JOIN str_aux.vectors v  ON v.symbol = u.symbol
                                 AND v.win = st.win
                                 AND v.ts = st.ts
GROUP BY 1,2
ORDER BY 1,2;

CREATE OR REPLACE VIEW debug.straux_gaps AS
SELECT sc.symbol, sc.win,
       sc.kline_rows, sc.ob_rows,
       COALESCE(sa.stats_rows,0)  AS stats_rows,
       COALESCE(sa.vector_rows,0) AS vector_rows,
       CASE
         WHEN (sc.kline_rows > 0 OR sc.ob_rows > 0) AND COALESCE(sa.stats_rows,0)=0 THEN 'MISSING_STATS'
         WHEN COALESCE(sa.stats_rows,0) > 0 AND COALESCE(sa.vector_rows,0)=0 THEN 'MISSING_VECTORS'
         WHEN sc.kline_rows=0 AND sc.ob_rows>0 THEN 'NO_KLINES_FOR_WINDOW'
         WHEN sc.kline_rows>0 AND sc.ob_rows=0 THEN 'NO_ORDERBOOK_SNAPSHOTS'
         ELSE 'OK_OR_EMPTY'
       END AS diagnosis
FROM debug.source_coverage sc
LEFT JOIN debug.straux_coverage sa
       ON sa.symbol = sc.symbol AND sa.win = sc.win
ORDER BY sc.symbol, sc.win;

--------------------------------------------------------------------------------
-- 5. PERMISSION SNAPSHOT
--------------------------------------------------------------------------------
CREATE OR REPLACE VIEW debug.perms AS
SELECT current_user AS usr,
       has_table_privilege(current_user,'str_aux.stats','INSERT')   AS can_ins_stats,
       has_table_privilege(current_user,'str_aux.vectors','INSERT') AS can_ins_vectors,
       has_table_privilege(current_user,'market.klines','SELECT')   AS can_sel_klines,
       has_table_privilege(current_user,'debug._ob_src','SELECT')   AS can_sel_ob_like;
