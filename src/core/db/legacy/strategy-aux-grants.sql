-- db/grants/strategy-aux-strengthen.sql
-- Ensure the app writer role can SELECT from snapshots and INSERT/UPDATE session.
-- Adjust role names if yours differ.
BEGIN;

-- Roles: dyn_writer writes via DATABASE_URL; dyn_owner owns objects (optional).
-- 1) Schema usage
GRANT USAGE ON SCHEMA public       TO dyn_writer;
GRANT USAGE ON SCHEMA strategy_aux TO dyn_writer;

-- 2) Exact tables the refresher uses
GRANT SELECT ON TABLE public.strategy_aux_snapshots           TO dyn_writer;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE strategy_aux.str_aux_session TO dyn_writer;

-- 3) Any other tables in strategy_aux (future-proof for maintenance)
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA strategy_aux TO dyn_writer;

-- 4) Sequences in strategy_aux (identity columns)
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT sequence_schema, sequence_name
    FROM information_schema.sequences
    WHERE sequence_schema = 'strategy_aux'
  LOOP
    EXECUTE format('GRANT USAGE, SELECT, UPDATE ON SEQUENCE %I.%I TO dyn_writer', r.sequence_schema, r.sequence_name);
  END LOOP;
END$$;

-- 5) Default privileges so new objects inherit sane grants
ALTER DEFAULT PRIVILEGES IN SCHEMA strategy_aux
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO dyn_writer;

ALTER DEFAULT PRIVILEGES IN SCHEMA strategy_aux
GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO dyn_writer;

COMMIT;
