-- 15_admin.sql
-- Combined admin DDL covering the former 15_roles.sql through 23_helpers.sql.

BEGIN;

-- ============================================================================
-- Roles and hierarchy (from 15_roles.sql)
-- ============================================================================
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'cp_admin') THEN
    CREATE ROLE cp_admin NOLOGIN;
  ELSE
    ALTER ROLE cp_admin NOLOGIN;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'cp_app') THEN
    CREATE ROLE cp_app NOLOGIN;
  ELSE
    ALTER ROLE cp_app NOLOGIN;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'cp_writer') THEN
    CREATE ROLE cp_writer NOLOGIN;
  ELSE
    ALTER ROLE cp_writer NOLOGIN;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'cp_reader') THEN
    CREATE ROLE cp_reader NOLOGIN;
  ELSE
    ALTER ROLE cp_reader NOLOGIN;
  END IF;
END$$;

GRANT cp_writer TO cp_app;
GRANT cp_reader TO cp_app;
GRANT cp_app    TO cp_admin;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'cryptopill_api') THEN
    CREATE ROLE cryptopill_api LOGIN PASSWORD 'replace_me' INHERIT;
  END IF;
  GRANT cp_app    TO cryptopill_api;

  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'cryptopill_jobs') THEN
    CREATE ROLE cryptopill_jobs LOGIN PASSWORD 'replace_me' INHERIT;
  END IF;
  GRANT cp_writer TO cryptopill_jobs;

  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'cryptopill_read') THEN
    CREATE ROLE cryptopill_read LOGIN PASSWORD 'replace_me' INHERIT;
  END IF;
  GRANT cp_reader TO cryptopill_read;
END$$;

-- ============================================================================
-- Security grants (from 16_security-grants.sql)
-- ============================================================================
REVOKE ALL ON SCHEMA public FROM PUBLIC;

GRANT USAGE ON SCHEMA
settings, market, docs, matrices, str_aux, cin_aux, mea_dynamics, ingest, ops
TO cp_app, cp_writer, cp_reader;

GRANT SELECT ON ALL TABLES IN SCHEMA
settings, market, docs, matrices, str_aux, cin_aux, mea_dynamics, ingest, ops
TO cp_reader;

GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA
market, docs, matrices, str_aux, cin_aux, mea_dynamics, ingest, ops
TO cp_app, cp_writer;

GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA market, matrices, mea_dynamics TO cp_app, cp_writer;

ALTER DEFAULT PRIVILEGES IN SCHEMA
market, docs, matrices, str_aux, cin_aux, mea_dynamics, ingest, ops
GRANT SELECT ON TABLES TO cp_reader;

ALTER DEFAULT PRIVILEGES IN SCHEMA
market, docs, matrices, str_aux, cin_aux, mea_dynamics, ingest, ops
GRANT SELECT,INSERT,UPDATE,DELETE ON TABLES TO cp_app, cp_writer;

ALTER DEFAULT PRIVILEGES IN SCHEMA
market, matrices, mea_dynamics
GRANT EXECUTE ON FUNCTIONS TO cp_app, cp_writer;

-- ============================================================================
-- Row level security base policies (from 17_security-rls.sql)
-- ============================================================================
DO $$
DECLARE
  rel   record;
  tab   text;
  sch   text;
  qual  text;
  pol_r text;
  pol_w text;

  tables text[] := ARRAY[
    'market.symbols',
    'market.klines',
    'market.ticker_ticks',
    'market.ticker_latest',
    'market.orderbook_snapshots',

    'str_aux.vectors_run',
    'str_aux.vectors_symbol',
    'str_aux.stats_run',
    'str_aux.stats_symbol',
    'str_aux.samples_run',
    'str_aux.samples_symbol',

    'cin_aux.sessions',
    'cin_aux.settings_coin_universe',
    'cin_aux.session_coin_universe',
    'cin_aux.mat_registry',
    'cin_aux.mat_cell',
    'cin_aux.mea_result',

    'mea_dynamics.mood_registry',
    'mea_dynamics.cycles',
    'mea_dynamics.mea_symbol',
    'mea_dynamics.dynamics_snapshot',

    'ops."order"',
    'ops.fill'
  ];
BEGIN
  FOREACH qual IN ARRAY tables LOOP
    sch := split_part(qual, '.', 1);
    tab := split_part(qual, '.', 2);

    SELECT n.nspname AS nsp, c.relname AS rel, c.relkind AS kind
      INTO rel
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = sch
       AND c.relname = tab
       AND c.relkind IN ('r','p')
     LIMIT 1;

    IF rel.rel IS NULL THEN
      CONTINUE;
    END IF;

    pol_r := format('%s_%s_p_read_all', rel.nsp, rel.rel);
    pol_w := format('%s_%s_p_write_all', rel.nsp, rel.rel);

    EXECUTE format('ALTER TABLE %I.%I ENABLE ROW LEVEL SECURITY', rel.nsp, rel.rel);

    IF NOT EXISTS (
      SELECT 1 FROM pg_policies
      WHERE schemaname = rel.nsp
        AND tablename  = rel.rel
        AND policyname = pol_r
    ) THEN
      EXECUTE format(
        'CREATE POLICY %I ON %I.%I
           FOR SELECT
           TO cp_reader, cp_writer, cp_admin
           USING (true)',
        pol_r, rel.nsp, rel.rel
      );
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM pg_policies
      WHERE schemaname = rel.nsp
        AND tablename  = rel.rel
        AND policyname = pol_w
    ) THEN
      EXECUTE format(
        'CREATE POLICY %I ON %I.%I
           FOR ALL
           TO cp_writer, cp_admin
           USING (true)
           WITH CHECK (true)',
        pol_w, rel.nsp, rel.rel
      );
    END IF;
  END LOOP;
END$$ LANGUAGE plpgsql;

-- ============================================================================
-- Session-aware RLS helpers (from 18_rls.sql)
-- ============================================================================
CREATE OR REPLACE FUNCTION public.current_cp_session_uuid()
RETURNS uuid
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT NULLIF(current_setting('app.current_session_id', true), '')::uuid
$$;

DO $plpgsql$
DECLARE
  item        text;
  nsp         text;
  rel         text;
  has_opening boolean;
  has_session boolean;
  pred        text;
  pol_r       text;
  pol_w       text;
BEGIN
  FOR item IN
    SELECT unnest(ARRAY[
      'ops."order"',
      'ops.fill',

      'str_aux.vectors_run',
      'str_aux.vectors_symbol',
      'str_aux.stats_run',
      'str_aux.stats_symbol',
      'str_aux.samples_run',
      'str_aux.samples_symbol',

      'cin_aux.mea_result',

      'mea_dynamics.mea_symbol',
      'mea_dynamics.dynamics_snapshot'
    ])
  LOOP
    nsp := split_part(item, '.', 1);
    rel := btrim(split_part(item, '.', 2), '"');

    IF NOT EXISTS (
      SELECT 1
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = nsp
        AND c.relname = rel
        AND c.relkind IN ('r','p')
    ) THEN
      CONTINUE;
    END IF;

    SELECT EXISTS (
             SELECT 1
             FROM pg_attribute
             WHERE attrelid = format('%I.%I', nsp, rel)::regclass
               AND attname  = 'opening_session_id'
               AND NOT attisdropped
           )
      INTO has_opening;

    SELECT EXISTS (
             SELECT 1
             FROM pg_attribute
             WHERE attrelid = format('%I.%I', nsp, rel)::regclass
               AND attname  = 'session_id'
               AND NOT attisdropped
           )
      INTO has_session;

    IF has_opening THEN
      pred := '(opening_session_id IS NULL OR opening_session_id = public.current_cp_session_uuid())';
    ELSIF has_session THEN
      pred := '(session_id = public.current_cp_session_uuid())';
    ELSE
      pred := 'true';
    END IF;

    EXECUTE format('ALTER TABLE %I.%I ENABLE ROW LEVEL SECURITY', nsp, rel);

    pol_r := format('%s_%s_p_read_all', nsp, rel);
    pol_w := format('%s_%s_p_write_all', nsp, rel);

    IF NOT EXISTS (
      SELECT 1 FROM pg_policies
      WHERE schemaname = nsp AND tablename = rel AND policyname = pol_r
    ) THEN
      EXECUTE format(
        'CREATE POLICY %I ON %I.%I
           FOR SELECT
           TO cp_reader, cp_app
           USING (%s)',
        pol_r, nsp, rel, pred
      );
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM pg_policies
      WHERE schemaname = nsp AND tablename = rel AND policyname = pol_w
    ) THEN
      EXECUTE format(
        'CREATE POLICY %I ON %I.%I
           FOR ALL
           TO cp_app
           USING (%s)
           WITH CHECK (%s)',
        pol_w, nsp, rel, pred, pred
      );
    END IF;
  END LOOP;
END
$plpgsql$;

-- ============================================================================
-- Per-role, per-database settings (from 19_security.sql)
-- ============================================================================
DO $$
DECLARE
  dbname text := current_database();
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'cryptopill_api') THEN
    EXECUTE format(
      'ALTER ROLE %I IN DATABASE %I SET search_path = settings, market, docs, matrices, str_aux, cin_aux, mea_dynamics, ingest, ops, public',
      'cryptopill_api', dbname
    );
    EXECUTE format(
      'ALTER ROLE %I IN DATABASE %I SET statement_timeout = %L',
      'cryptopill_api', dbname, '30s'
    );
    EXECUTE format(
      'ALTER ROLE %I IN DATABASE %I SET lock_timeout = %L',
      'cryptopill_api', dbname, '5s'
    );
  END IF;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'cryptopill_jobs') THEN
    EXECUTE format(
      'ALTER ROLE %I IN DATABASE %I SET search_path = settings, market, docs, matrices, str_aux, cin_aux, mea_dynamics, ingest, ops, public',
      'cryptopill_jobs', dbname
    );
    EXECUTE format(
      'ALTER ROLE %I IN DATABASE %I SET statement_timeout = %L',
      'cryptopill_jobs', dbname, '2min'
    );
    EXECUTE format(
      'ALTER ROLE %I IN DATABASE %I SET lock_timeout = %L',
      'cryptopill_jobs', dbname, '10s'
    );
  END IF;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'cryptopill_read') THEN
    EXECUTE format(
      'ALTER ROLE %I IN DATABASE %I SET search_path = settings, market, docs, matrices, str_aux, cin_aux, mea_dynamics, ingest, ops, public',
      'cryptopill_read', dbname
    );
    EXECUTE format(
      'ALTER ROLE %I IN DATABASE %I SET statement_timeout = %L',
      'cryptopill_read', dbname, '30s'
    );
    EXECUTE format(
      'ALTER ROLE %I IN DATABASE %I SET lock_timeout = %L',
      'cryptopill_read', dbname, '5s'
    );
  END IF;
END$$;

-- ============================================================================
-- Vitals schema + helpers (from 20_vitals.sql)
-- ============================================================================
CREATE SCHEMA IF NOT EXISTS vitals;

CREATE OR REPLACE VIEW vitals.search_path_effective AS
SELECT current_user AS as_user,
       current_database() AS db,
       current_setting('search_path', true) AS search_path;

CREATE OR REPLACE VIEW vitals.role_db_settings AS
SELECT r.rolname, d.datname, s.setconfig
FROM pg_db_role_setting s
JOIN pg_roles r ON r.oid = s.setrole
JOIN pg_database d ON d.oid = s.setdatabase
WHERE d.datname = current_database()
ORDER BY r.rolname;

CREATE OR REPLACE VIEW vitals.object_counts AS
SELECT n.nspname AS schema,
       c.relname AS name,
       c.relkind AS kind,
       COALESCE(s.n_live_tup, c.reltuples)::bigint AS approx_rows
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
LEFT JOIN pg_stat_all_tables s ON s.relid = c.oid
WHERE n.nspname IN ('settings','market','docs','matrices','str_aux','cin_aux','mea_dynamics','ingest','ops','public')
  AND c.relkind IN ('r','p','v','m','S')
ORDER BY 1,3,2;

DO $$
DECLARE
  parts text[] := ARRAY[]::text[];
BEGIN
  IF to_regclass('str_aux.samples_run') IS NOT NULL THEN
    parts := array_append(parts,
      'SELECT ''samples''::text AS kind, COUNT(*)::bigint AS runs FROM str_aux.samples_run');
  ELSE
    parts := array_append(parts,
      'SELECT ''samples''::text AS kind, 0::bigint AS runs');
  END IF;

  IF to_regclass('str_aux.vectors_run') IS NOT NULL THEN
    parts := array_append(parts,
      'SELECT ''vectors''::text AS kind, COUNT(*)::bigint AS runs FROM str_aux.vectors_run');
  ELSE
    parts := array_append(parts,
      'SELECT ''vectors''::text AS kind, 0::bigint AS runs');
  END IF;

  IF to_regclass('str_aux.stats_run') IS NOT NULL THEN
    parts := array_append(parts,
      'SELECT ''stats''::text AS kind, COUNT(*)::bigint AS runs FROM str_aux.stats_run');
  ELSE
    parts := array_append(parts,
      'SELECT ''stats''::text AS kind, 0::bigint AS runs');
  END IF;

  EXECUTE 'CREATE OR REPLACE VIEW vitals.latest_runs AS '
       || array_to_string(parts, ' UNION ALL ');
END$$;

CREATE OR REPLACE VIEW vitals.wallets AS
WITH base AS (
  SELECT COUNT(*)::bigint AS total_rows,
         COUNT(DISTINCT asset)::bigint AS distinct_assets
  FROM market.wallet_balances
),
snap AS (
  SELECT COUNT(*)::bigint AS latest_rows
  FROM market.wallet_balances_latest
)
SELECT b.total_rows, b.distinct_assets, s.latest_rows
FROM base b CROSS JOIN snap s;

CREATE OR REPLACE VIEW vitals.matrices_health AS
SELECT
  (SELECT COUNT(*)::bigint FROM cin_aux.mat_registry) AS mat_registry_rows,
  (SELECT COUNT(*)::bigint FROM cin_aux.mat_cell)     AS mat_cell_rows,
  (to_regclass('matrices.dyn_values') IS NOT NULL)    AS dyn_values_exists;

CREATE OR REPLACE VIEW vitals.dynamics_health AS
SELECT
  (SELECT COUNT(*)::bigint FROM mea_dynamics.mea_symbol)        AS mea_symbol_rows,
  (SELECT COUNT(*)::bigint FROM mea_dynamics.dynamics_snapshot) AS snapshot_rows,
  (SELECT COUNT(*)::bigint FROM mea_dynamics.dynamics_latest)   AS latest_rows;

CREATE OR REPLACE FUNCTION vitals.status_snapshot()
RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE j jsonb := '{}'::jsonb;
BEGIN
  j := j || jsonb_build_object('search_path_effective',
        (SELECT jsonb_build_object('user', as_user, 'db', db, 'search_path', search_path)
           FROM vitals.search_path_effective));
  j := j || jsonb_build_object('role_db_settings',
        (SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY rolname), '[]'::jsonb)
           FROM vitals.role_db_settings t));
  j := j || jsonb_build_object('latest_runs',
        (SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY kind), '[]'::jsonb)
           FROM vitals.latest_runs t));
  j := j || jsonb_build_object('wallets',
        (SELECT to_jsonb(t) FROM vitals.wallets t));
  j := j || jsonb_build_object('matrices_health',
        (SELECT to_jsonb(t) FROM vitals.matrices_health t));
  j := j || jsonb_build_object('dynamics_health',
        (SELECT to_jsonb(t) FROM vitals.dynamics_health t));
  j := j || jsonb_build_object('object_counts',
        (SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY schema, kind, name), '[]'::jsonb)
           FROM vitals.object_counts t));
  RETURN j;
END$$;

-- ============================================================================
-- Public schema grants patch (from 21_security_grants_patch.sql)
-- ============================================================================
GRANT USAGE ON SCHEMA public TO cryptopill_api, cryptopill_read, cryptopill_jobs;
GRANT SELECT ON ALL TABLES    IN SCHEMA public TO cryptopill_api, cryptopill_read, cryptopill_jobs;
GRANT SELECT ON ALL SEQUENCES IN SCHEMA public TO cryptopill_api, cryptopill_read, cryptopill_jobs;

ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT ON TABLES TO cryptopill_api, cryptopill_read, cryptopill_jobs;

-- ============================================================================
-- Wallet helper patch (from 22_wallet_helper_patch.sql)
-- ============================================================================
CREATE OR REPLACE FUNCTION market.sync_wallet_assets_from_universe_helper()
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO market.wallet_balances(asset, ts, free_amt, locked_amt, meta)
  SELECT cu.base_asset, clock_timestamp(), 0, 0, '{}'::jsonb
  FROM settings.coin_universe cu
  WHERE cu.enabled
    AND cu.base_asset IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM market.wallet_balances wb WHERE wb.asset = cu.base_asset
    )
  ON CONFLICT DO NOTHING;

  INSERT INTO market.wallet_balances(asset, ts, free_amt, locked_amt, meta)
  SELECT cu.quote_asset, clock_timestamp(), 0, 0, '{}'::jsonb
  FROM settings.coin_universe cu
  WHERE cu.enabled
    AND cu.quote_asset IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM market.wallet_balances wb WHERE wb.asset = cu.quote_asset
    )
  ON CONFLICT DO NOTHING;
END$$;

-- ============================================================================
-- Session helpers (from 23_helpers.sql)
-- ============================================================================
CREATE OR REPLACE FUNCTION public.begin_cp_session(p_label text DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql AS $$
DECLARE sid uuid := gen_random_uuid();
BEGIN
  PERFORM set_config('app.current_session_id', sid::text, false);
  RETURN sid;
END$$;

CREATE OR REPLACE FUNCTION public.end_cp_session(p_session uuid)
RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('app.current_session_id', '', false);
END$$;

COMMIT;
