BEGIN;

-- =========================================================
-- Schema + enums
-- =========================================================
CREATE SCHEMA IF NOT EXISTS ops;

DO $$
BEGIN
  CREATE TYPE ops.side AS ENUM ('buy','sell');
EXCEPTION WHEN duplicate_object THEN
  NULL;
END$$;

DO $$
BEGIN
  CREATE TYPE ops.status AS ENUM ('requested','placed','rejected','filled','cancelled','expired');
EXCEPTION WHEN duplicate_object THEN
  NULL;
END$$;

-- =========================================================
-- Tables
-- =========================================================
CREATE TABLE IF NOT EXISTS ops."order" (
  order_id   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES cin_aux.sessions(session_id) ON DELETE CASCADE,
  symbol     text NOT NULL,
  side       ops.side NOT NULL,
  qty        numeric(36,18) NOT NULL,
  px         numeric(36,18),
  kind       text NOT NULL DEFAULT 'market',
  status     ops.status NOT NULL DEFAULT 'requested',
  paper      boolean NOT NULL DEFAULT true,
  meta       jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS ops.fill (
  fill_id    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id   uuid NOT NULL REFERENCES ops."order"(order_id) ON DELETE CASCADE,
  symbol     text NOT NULL,
  qty        numeric(36,18) NOT NULL,
  px         numeric(36,18) NOT NULL,
  fee        numeric(36,18) NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- normalize numeric scales (idempotent)
ALTER TABLE ops."order"
  ALTER COLUMN qty TYPE numeric(38,18) USING qty::numeric,
  ALTER COLUMN px  TYPE numeric(38,18) USING px::numeric;

ALTER TABLE ops.fill
  ALTER COLUMN qty TYPE numeric(38,18) USING qty::numeric,
  ALTER COLUMN px  TYPE numeric(38,18) USING px::numeric,
  ALTER COLUMN fee TYPE numeric(38,18) USING fee::numeric;

-- stamp columns (idempotent)
ALTER TABLE ops."order"
  ADD COLUMN IF NOT EXISTS opening_stamp      boolean     NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS opening_session_id uuid,
  ADD COLUMN IF NOT EXISTS opening_ts         timestamptz,
  ADD COLUMN IF NOT EXISTS print_stamp        boolean     NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS print_ts           timestamptz;

ALTER TABLE ops.fill
  ADD COLUMN IF NOT EXISTS opening_stamp      boolean     NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS opening_session_id uuid,
  ADD COLUMN IF NOT EXISTS opening_ts         timestamptz,
  ADD COLUMN IF NOT EXISTS print_stamp        boolean     NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS print_ts           timestamptz;

-- convenience indexes
CREATE INDEX IF NOT EXISTS ops_order_symbol_idx   ON ops."order"(symbol);
CREATE INDEX IF NOT EXISTS ops_order_status_idx   ON ops."order"(status, updated_at DESC);
CREATE INDEX IF NOT EXISTS ops_fill_symbol_idx    ON ops.fill(symbol);
CREATE INDEX IF NOT EXISTS ops_fill_created_idx   ON ops.fill(created_at DESC);

-- =========================================================
-- Guarded FKs (PG-14-safe; no NOT VALID / no IF NOT EXISTS on constraints)
-- =========================================================

-- 1) ops.order.symbol → market.symbols(symbol)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'fk_ops_order_symbol'
      AND conrelid = 'ops."order"'::regclass
  ) THEN
    ALTER TABLE ops."order"
      ADD CONSTRAINT fk_ops_order_symbol
      FOREIGN KEY (symbol)
      REFERENCES market.symbols(symbol)
      ON UPDATE CASCADE
      ON DELETE RESTRICT;
  END IF;
END$$ LANGUAGE plpgsql;

-- 2) opening_session_id → cin_aux.sessions(session_id), only if uuid
DO $$
DECLARE
  sess_exists boolean;
  id_type     text;
BEGIN
  SELECT EXISTS (
    SELECT 1
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'cin_aux' AND c.relname = 'sessions'
  ) INTO sess_exists;

  IF sess_exists THEN
    SELECT atttypid::regtype::text
      INTO id_type
    FROM pg_attribute
    WHERE attrelid = 'cin_aux.sessions'::regclass
      AND attname  = 'session_id'
      AND NOT attisdropped;

    IF id_type = 'uuid' THEN
      -- ops.order.opening_session_id
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'fk_ops_order_opening_session'
          AND conrelid = 'ops."order"'::regclass
      ) THEN
        ALTER TABLE ops."order"
          ADD CONSTRAINT fk_ops_order_opening_session
          FOREIGN KEY (opening_session_id)
          REFERENCES cin_aux.sessions(session_id)
          ON DELETE SET NULL;
      END IF;

      -- ops.fill.opening_session_id
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'fk_ops_fill_opening_session'
          AND conrelid = 'ops.fill'::regclass
      ) THEN
        ALTER TABLE ops.fill
          ADD CONSTRAINT fk_ops_fill_opening_session
          FOREIGN KEY (opening_session_id)
          REFERENCES cin_aux.sessions(session_id)
          ON DELETE SET NULL;
      END IF;
    END IF;
  END IF;
END$$ LANGUAGE plpgsql;

COMMIT;

CREATE SCHEMA IF NOT EXISTS ops;

CREATE TABLE IF NOT EXISTS ops.app_ledger (
  id                bigserial PRIMARY KEY,
  topic             text NOT NULL,
  event             text NOT NULL,
  payload           jsonb,
  session_id        text,
  idempotency_key   text UNIQUE,
  ts_epoch_ms       bigint NOT NULL,
  created_at        timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_ops_app_ledger_topic_time
  ON ops.app_ledger (topic, ts_epoch_ms DESC);
