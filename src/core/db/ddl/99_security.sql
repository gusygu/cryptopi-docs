-- 99_security.sql
-- Final hardening pass: remove PUBLIC access from app schemas.
-- This file is intentionally conservative: it only REVOKEs from PUBLIC
-- and leaves cp_* role GRANTs as defined in earlier DDLs.

BEGIN;

-- Helper DO block to revoke PUBLIC access on a schema if it exists
DO $$
DECLARE
  s text;
BEGIN
  FOR s IN
    SELECT unnest(ARRAY[
      'public',
      'settings',
      'market',
      'documents',
      'wallet',
      'ops',
      'matrices',
      'str_aux',
      'cin_aux',
      'mea_dynamics',
      'ingest',
      'units',
      'admin',
      'auth',
      'debug'
    ])
  LOOP
    IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = s) THEN
      -- Revoke generic access on the schema from PUBLIC
      EXECUTE format('REVOKE ALL ON SCHEMA %I FROM PUBLIC;', s);

      -- Revoke all table privileges in that schema from PUBLIC
      EXECUTE format('REVOKE ALL ON ALL TABLES IN SCHEMA %I FROM PUBLIC;', s);

      -- Revoke all sequence privileges in that schema from PUBLIC
      EXECUTE format('REVOKE ALL ON ALL SEQUENCES IN SCHEMA %I FROM PUBLIC;', s);
    END IF;
  END LOOP;
END $$;

-- Extra: avoid random object creation in public schema by PUBLIC
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'public') THEN
    REVOKE CREATE ON SCHEMA public FROM PUBLIC;
  END IF;
END $$;

COMMIT;
