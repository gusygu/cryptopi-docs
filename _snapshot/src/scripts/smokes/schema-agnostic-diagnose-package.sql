-- === STR-AUX Diagnostics (schema-agnostic) ===
-- Safe to run multiple times. Creates/updates debug views.

CREATE SCHEMA IF NOT EXISTS debug;

-- 0) helper: does a table exist?
--    (we'll reuse this pattern inside DO blocks)
--    No persistent function needed—just inline checks in each DO.

-- 1) Normalize market.symbols -> debug._symbols(symbol TEXT, base TEXT, quote TEXT)
DO $$
DECLARE has_symbol_id boolean;
BEGIN
  -- ensure a symbols source exists
  IF NOT EXISTS (
    SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='market' AND c.relname='symbols' AND c.relkind IN ('r','p','v','m')
  ) THEN
    RAISE NOTICE 'market.symbols not found; creating empty debug._symbols';
    EXECUTE $v$ CREATE OR REPLACE VIEW debug._symbols AS
      SELECT NULL::text AS symbol, NULL::text AS base, NULL::text AS quote WHERE false $v$;
    RETURN;
  END IF;

  -- detect columns
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='market' AND table_name='symbols' AND column_name='symbol_id'
  ) INTO has_symbol_id;

  IF has_symbol_id THEN
    -- prefer text symbol if present, else synthesize from base/quote if they exist
    EXECUTE $v$
      CREATE OR REPLACE VIEW debug._symbols AS
      SELECT
        COALESCE(
          NULLIF(s.symbol::text, ''),
          CASE
            WHEN s.base IS NOT NULL AND s.quote IS NOT NULL THEN s.base||'/'||s.quote
            ELSE NULL
          END
        ) AS symbol,
        s.base::text AS base,
        s.quote::text AS quote
      FROM market.symbols s
    $v$;
  ELSE
    EXECUTE $v$
      CREATE OR REPLACE VIEW debug._symbols AS
      SELECT
        COALESCE(
          NULLIF(s.symbol::text, ''),
          CASE
            WHEN s.base IS NOT NULL AND s.quote IS NOT NULL THEN s.base||'/'||s.quote
            ELSE NULL
          END
        ) AS symbol,
        s.base::text AS base,
        s.quote::text AS quote
      FROM market.symbols s
    $v$;
  END IF;
END $$;

-- 2) Normalize KLINES into debug._klines_src(symbol TEXT, ts TIMESTAMPTZ, window TEXT)
DO $$
DECLARE has_klines boolean;
        has_window boolean;
        has_timeframe boolean;
        has_interval boolean;
        has_symbol_id boolean;
        has_symbol_text boolean;
        sql text;
BEGIN
  -- case A: a single table/view `market.klines`
  SELECT EXISTS (
    SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='market' AND c.relname='klines' AND c.relkind IN ('r','p','v','m')
  ) INTO has_klines;

  IF has_klines THEN
    SELECT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema='market' AND table_name='klines' AND column_name='window'
    ) INTO has_window;

    SELECT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema='market' AND table_name='klines' AND column_name='timeframe'
    ) INTO has_timeframe;

    SELECT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema='market' AND table_name='klines' AND column_name='interval'
    ) INTO has_interval;

    SELECT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema='market' AND table_name='klines' AND column_name='symbol'
    ) INTO has_symbol_text;

    SELECT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema='market' AND table_name='klines' AND column_name='symbol_id'
    ) INTO has_symbol_id;

    sql := 'CREATE OR REPLACE VIEW debug._klines_src AS SELECT ';

    IF has_symbol_text THEN
      sql := sql || 'k.symbol::text AS symbol, ';
    ELSIF has_symbol_id THEN
      sql := sql || 'COALESCE(NULLIF(ms.symbol, ''''), ms.base||''/''||ms.quote) AS symbol, ';
    ELSE
      sql := sql || 'NULL::text AS symbol, ';
    END IF;

    sql := sql || 'k.ts::timestamptz AS ts, ';

    IF has_window THEN
      sql := sql || 'k.window::text AS window ';
    ELSIF has_timeframe THEN
      sql := sql || 'k.timeframe::text AS window ';
    ELSIF has_interval THEN
      sql := sql || 'k.interval::text AS window ';
    ELSE
      sql := sql || 'NULL::text AS window ';
    END IF;

    sql := sql || 'FROM market.klines k ';

    IF has_symbol_id AND NOT has_symbol_text THEN
      sql := sql || 'LEFT JOIN market.symbols ms ON ms.symbol_id = k.symbol_id ';
    END IF;

    EXECUTE sql;
    RETURN;
  END IF;

  -- case B: multiple tables: market.klines_1m, market.klines_3m, ...
  sql := NULL;
  FOR sql IN
    SELECT format(
      $$SELECT
           %s AS symbol,
           k.ts::timestamptz AS ts,
           %L::text AS window
        FROM market.%I k
        %s$$,
      CASE
        WHEN EXISTS (SELECT 1 FROM information_schema.columns
                     WHERE table_schema='market' AND table_name=t.relname AND column_name='symbol')
          THEN 'k.symbol::text'
        WHEN EXISTS (SELECT 1 FROM information_schema.columns
                     WHERE table_schema='market' AND table_name=t.relname AND column_name='symbol_id')
          THEN 'COALESCE(NULLIF(ms.symbol, ''''), ms.base||''/''||ms.quote)'
        ELSE 'NULL::text'
      END,
      regexp_replace(t.relname, '^klines_', ''),
      t.relname,
      CASE
        WHEN EXISTS (SELECT 1 FROM information_schema.columns
                     WHERE table_schema='market' AND table_name=t.relname AND column_name='symbol_id')
          THEN 'LEFT JOIN market.symbols ms ON ms.symbol_id = k.symbol_id'
        ELSE ''
      END
    )
    FROM pg_class t
    JOIN pg_namespace n ON n.oid=t.relnamespace
    WHERE n.nspname='market' AND t.relname ~ '^klines_[a-z0-9]+$' AND t.relkind IN ('r','p','v','m')
  LOOP
    IF sql IS NOT NULL THEN
      IF EXISTS (SELECT 1 FROM pg_views WHERE schemaname='debug' AND viewname='_klines_src') THEN
        EXECUTE 'CREATE OR REPLACE VIEW debug._klines_src AS '||
                (SELECT definition FROM pg_views WHERE schemaname='debug' AND viewname='_klines_src')||
                ' UNION ALL '||sql;
      ELSE
        EXECUTE 'CREATE OR REPLACE VIEW debug._klines_src AS '||sql;
      END IF;
    END IF;
  END LOOP;

  IF NOT EXISTS (SELECT 1 FROM pg_views WHERE schemaname='debug' AND viewname='_klines_src') THEN
    -- nothing found; create empty
    EXECUTE 'CREATE OR REPLACE VIEW debug._klines_src AS SELECT NULL::text AS symbol, NULL::timestamptz AS ts, NULL::text AS window WHERE false';
  END IF;
END $$;

-- 3) Normalize ORDERBOOK into debug._ob_src(symbol TEXT, ts TIMESTAMPTZ)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='market' AND c.relname='orderbook_snapshots' AND c.relkind IN ('r','p','v','m')
  ) THEN
    IF EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_schema='market' AND table_name='orderbook_snapshots' AND column_name='symbol') THEN
      EXECUTE $v$ CREATE OR REPLACE VIEW debug._ob_src AS
        SELECT symbol::text AS symbol, ts::timestamptz AS ts
        FROM market.orderbook_snapshots $v$;
    ELSIF EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema='market' AND table_name='orderbook_snapshots' AND column_name='symbol_id') THEN
      EXECUTE $v$ CREATE OR REPLACE VIEW debug._ob_src AS
        SELECT COALESCE(NULLIF(ms.symbol,''), ms.base||'/'||ms.quote) AS symbol,
               o.ts::timestamptz AS ts
        FROM market.orderbook_snapshots o
        LEFT JOIN market.symbols ms ON ms.symbol_id=o.symbol_id $v$;
    ELSE
      EXECUTE $v$ CREATE OR REPLACE VIEW debug._ob_src AS
        SELECT NULL::text AS symbol, NULL::timestamptz AS ts WHERE false $v$;
    END IF;
  ELSE
    EXECUTE $v$ CREATE OR REPLACE VIEW debug._ob_src AS
      SELECT NULL::text AS symbol, NULL::timestamptz AS ts WHERE false $v$;
  END IF;
END $$;

-- 4) Normalize STR-AUX stats/vectors into debug._stats_src / debug._vectors_src
DO $$
BEGIN
  -- stats
  IF EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
             WHERE n.nspname='str_aux' AND c.relname='stats' AND c.relkind IN ('r','p','v','m')) THEN
    IF EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_schema='str_aux' AND table_name='stats' AND column_name='symbol') THEN
      EXECUTE $v$ CREATE OR REPLACE VIEW debug._stats_src AS
        SELECT symbol::text AS symbol, ts::timestamptz AS ts, window::text AS window
        FROM str_aux.stats $v$;
    ELSIF EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema='str_aux' AND table_name='stats' AND column_name='symbol_id') THEN
      EXECUTE $v$ CREATE OR REPLACE VIEW debug._stats_src AS
        SELECT COALESCE(NULLIF(ms.symbol,''), ms.base||'/'||ms.quote) AS symbol,
               st.ts::timestamptz AS ts,
               st.window::text AS window
        FROM str_aux.stats st
        LEFT JOIN market.symbols ms ON ms.symbol_id=st.symbol_id $v$;
    ELSE
      EXECUTE $v$ CREATE OR REPLACE VIEW debug._stats_src AS
        SELECT NULL::text AS symbol, NULL::timestamptz AS ts, NULL::text AS window WHERE false $v$;
    END IF;
  ELSE
    EXECUTE $v$ CREATE OR REPLACE VIEW debug._stats_src AS
      SELECT NULL::text AS symbol, NULL::timestamptz AS ts, NULL::text AS window WHERE false $v$;
  END IF;

  -- vectors
  IF EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
             WHERE n.nspname='str_aux' AND c.relname='vectors' AND c.relkind IN ('r','p','v','m')) THEN
    IF EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_schema='str_aux' AND table_name='vectors' AND column_name='symbol') THEN
      EXECUTE $v$ CREATE OR REPLACE VIEW debug._vectors_src AS
        SELECT symbol::text AS symbol, ts::timestamptz AS ts, window::text AS window
        FROM str_aux.vectors $v$;
    ELSIF EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema='str_aux' AND table_name='vectors' AND column_name='symbol_id') THEN
      EXECUTE $v$ CREATE OR REPLACE VIEW debug._vectors_src AS
        SELECT COALESCE(NULLIF(ms.symbol,''), ms.base||'/'||ms.quote) AS symbol,
               v.ts::timestamptz AS ts,
               v.window::text AS window
        FROM str_aux.vectors v
        LEFT JOIN market.symbols ms ON ms.symbol_id=v.symbol_id $v$;
    ELSE
      EXECUTE $v$ CREATE OR REPLACE VIEW debug._vectors_src AS
        SELECT NULL::text AS symbol, NULL::timestamptz AS ts, NULL::text AS window WHERE false $v$;
    END IF;
  ELSE
    EXECUTE $v$ CREATE OR REPLACE VIEW debug._vectors_src AS
      SELECT NULL::text AS symbol, NULL::timestamptz AS ts, NULL::text AS window WHERE false $v$;
  END IF;
END $$;

-- 5) Coverage + gaps using normalized sources
CREATE OR REPLACE VIEW debug.source_coverage AS
SELECT sy.symbol,
       kl.window,
       COUNT(kl.*) FILTER (WHERE kl.ts IS NOT NULL) AS kline_rows,
       COUNT(ob.*) FILTER (WHERE ob.ts IS NOT NULL) AS ob_rows
FROM debug._symbols sy
LEFT JOIN debug._klines_src kl ON kl.symbol = sy.symbol
LEFT JOIN debug._ob_src     ob ON ob.symbol = sy.symbol
GROUP BY 1,2
ORDER BY 1,2;

CREATE OR REPLACE VIEW debug.straux_coverage AS
SELECT sy.symbol,
       st.window,
       COUNT(st.*) AS stats_rows,
       COUNT(v.*)  FILTER (WHERE v.ts IS NOT NULL) AS vector_rows
FROM debug._symbols sy
LEFT JOIN debug._stats_src   st ON st.symbol = sy.symbol
LEFT JOIN debug._vectors_src v  ON v.symbol = sy.symbol
                                 AND v.window = st.window
                                 AND v.ts = st.ts
GROUP BY 1,2
ORDER BY 1,2;

CREATE OR REPLACE VIEW debug.straux_gaps AS
SELECT sc.symbol, sc.window,
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
       ON sa.symbol = sc.symbol AND sa.window = sc.window
ORDER BY sc.symbol, sc.window;

-- 6) Windows present from klines (normalized)
CREATE OR REPLACE VIEW debug.windows_by_symbol AS
SELECT symbol, window, COUNT(*) AS n
FROM debug._klines_src
GROUP BY 1,2
ORDER BY 1,2;

-- 7) Permission probe
CREATE OR REPLACE VIEW debug.perms AS
SELECT current_user AS usr,
       has_table_privilege(current_user,'str_aux.stats','INSERT')   AS can_ins_stats,
       has_table_privilege(current_user,'str_aux.vectors','INSERT') AS can_ins_vectors,
       has_table_privilege(current_user,'debug._klines_src','SELECT') AS can_sel_klines_like,
       has_table_privilege(current_user,'debug._ob_src','SELECT')     AS can_sel_ob_like;
