-- 1) make sure we have the debug schema
CREATE SCHEMA IF NOT EXISTS debug;

-- 2) KLINES: normalize to (symbol, ts, win) using your columns
CREATE OR REPLACE VIEW debug._klines_win AS
SELECT
  k.symbol::text                 AS symbol,
  k.open_time::timestamptz       AS ts,
  k.window_label::text           AS win
FROM market.klines k;

-- 3) ORDERBOOK: safe alias (empty if table not present)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='market' AND c.relname='orderbook_snapshots' AND c.relkind IN ('r','p','v','m')
  ) THEN
    EXECUTE $v$ CREATE OR REPLACE VIEW debug._ob_src AS
      SELECT symbol::text AS symbol, ts::timestamptz AS ts
      FROM market.orderbook_snapshots $v$;
  ELSE
    EXECUTE 'CREATE OR REPLACE VIEW debug._ob_src AS SELECT NULL::text AS symbol, NULL::timestamptz AS ts WHERE false';
  END IF;
END $$;

-- 4) SYMBOLS list (text)
CREATE OR REPLACE VIEW debug.symbols AS
SELECT
  COALESCE(NULLIF(s.symbol::text,''),
           CASE WHEN s.base IS NOT NULL AND s.quote IS NOT NULL THEN s.base||'/'||s.quote END
  ) AS symbol,
  s.base::text AS base,
  s.quote::text AS quote
FROM market.symbols s;

-- 5) STR_AUX: normalize STATS/VECTORS to (symbol, ts, win)
--    prefer "window" if it exists, else "window_label", else NULL
DO $$
BEGIN
  -- stats
  BEGIN
    EXECUTE $v$ CREATE OR REPLACE VIEW debug._stats_win AS
      SELECT symbol::text AS symbol,
             ts::timestamptz AS ts,
             COALESCE("window"::text, "window_label"::text, NULL::text) AS win
      FROM str_aux.stats $v$;
  EXCEPTION WHEN undefined_table THEN
    EXECUTE 'CREATE OR REPLACE VIEW debug._stats_win AS SELECT NULL::text AS symbol, NULL::timestamptz AS ts, NULL::text AS win WHERE false';
  WHEN undefined_column THEN
    EXECUTE $v$ CREATE OR REPLACE VIEW debug._stats_win AS
      SELECT symbol::text AS symbol,
             ts::timestamptz AS ts,
             NULL::text AS win
      FROM str_aux.stats $v$;
  END;

  -- vectors
  BEGIN
    EXECUTE $v$ CREATE OR REPLACE VIEW debug._vectors_win AS
      SELECT symbol::text AS symbol,
             ts::timestamptz AS ts,
             COALESCE("window"::text, "window_label"::text, NULL::text) AS win
      FROM str_aux.vectors $v$;
  EXCEPTION WHEN undefined_table THEN
    EXECUTE 'CREATE OR REPLACE VIEW debug._vectors_win AS SELECT NULL::text AS symbol, NULL::timestamptz AS ts, NULL::text AS win WHERE false';
  WHEN undefined_column THEN
    EXECUTE $v$ CREATE OR REPLACE VIEW debug._vectors_win AS
      SELECT symbol::text AS symbol,
             ts::timestamptz AS ts,
             NULL::text AS win
      FROM str_aux.vectors $v$;
  END;
END $$;

-- 6) Coverage + Gaps (per symbol & window_label)
CREATE OR REPLACE VIEW debug.source_coverage AS
SELECT sy.symbol,
       kl.win,
       COUNT(kl.*) FILTER (WHERE kl.ts IS NOT NULL) AS kline_rows,
       COUNT(ob.*) FILTER (WHERE ob.ts IS NOT NULL) AS ob_rows
FROM debug.symbols sy
LEFT JOIN debug._klines_win kl ON kl.symbol = sy.symbol
LEFT JOIN debug._ob_src     ob ON ob.symbol = sy.symbol
GROUP BY 1,2
ORDER BY 1,2;

CREATE OR REPLACE VIEW debug.straux_coverage AS
SELECT sy.symbol,
       st.win,
       COUNT(st.*) AS stats_rows,
       COUNT(v.*)  FILTER (WHERE v.ts IS NOT NULL) AS vector_rows
FROM debug.symbols sy
LEFT JOIN debug._stats_win   st ON st.symbol = sy.symbol
LEFT JOIN debug._vectors_win v  ON v.symbol = sy.symbol
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

-- 7) Perms (optional)
CREATE OR REPLACE VIEW debug.perms AS
SELECT current_user AS usr,
       has_table_privilege(current_user,'str_aux.stats','INSERT')     AS can_ins_stats,
       has_table_privilege(current_user,'str_aux.vectors','INSERT')   AS can_ins_vectors,
       has_table_privilege(current_user,'market.klines','SELECT')     AS can_sel_klines,
       has_table_privilege(current_user,'debug._ob_src','SELECT')     AS can_sel_ob_like;


-- If str_aux isn’t created yet, make the debug views empty + safe.

DROP VIEW IF EXISTS debug._stats_win CASCADE;
CREATE OR REPLACE VIEW debug._stats_win AS
SELECT NULL::text AS symbol, NULL::timestamptz AS ts, NULL::text AS win
WHERE false;

DROP VIEW IF EXISTS debug._vectors_win CASCADE;
CREATE OR REPLACE VIEW debug._vectors_win AS
SELECT NULL::text AS symbol, NULL::timestamptz AS ts, NULL::text AS win
WHERE false;
