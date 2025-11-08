BEGIN;

-- Ensure dyn_app can reach the schemas
GRANT USAGE ON SCHEMA public       TO dyn_app;
GRANT USAGE ON SCHEMA strategy_aux TO dyn_app;

-- Read snapshots (public)
GRANT SELECT ON TABLE public.strategy_aux_snapshots TO dyn_app;

-- Write session table (strategy_aux)
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE strategy_aux.str_aux_session TO dyn_app;

-- Also cover all current tables in strategy_aux (future-proof if you add more)
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA strategy_aux TO dyn_app;

-- Sequences in strategy_aux (identity/serial columns)
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT sequence_schema, sequence_name
    FROM information_schema.sequences
    WHERE sequence_schema = 'strategy_aux'
  LOOP
    EXECUTE format('GRANT USAGE, SELECT, UPDATE ON SEQUENCE %I.%I TO dyn_app', r.sequence_schema, r.sequence_name);
  END LOOP;
END$$;

-- Default privileges for new objects (optional, keeps things predictable)
ALTER DEFAULT PRIVILEGES IN SCHEMA strategy_aux
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO dyn_app;

ALTER DEFAULT PRIVILEGES IN SCHEMA strategy_aux
GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO dyn_app;

COMMIT;
