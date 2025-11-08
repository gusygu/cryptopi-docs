-- 01_extensions.sql  (clean, safe to re-apply)
CREATE EXTENSION IF NOT EXISTS pgcrypto;   -- gen_random_uuid
-- citext is optional; enable if available
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_available_extensions WHERE name='citext') THEN
    EXECUTE 'CREATE EXTENSION IF NOT EXISTS citext';
  END IF;
END$$;
CREATE EXTENSION IF NOT EXISTS btree_gin;
CREATE EXTENSION IF NOT EXISTS btree_gist;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
-- hstore is optional nowadays; keep only if you actually use it
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_available_extensions WHERE name='hstore') THEN
    EXECUTE 'CREATE EXTENSION IF NOT EXISTS hstore';
  END IF;
END$$;

-- common updated_at trigger
CREATE SCHEMA IF NOT EXISTS util;
CREATE OR REPLACE FUNCTION util.touch_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END $$;
