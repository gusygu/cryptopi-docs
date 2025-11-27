BEGIN;

-- ============================================================================
-- Schema
-- ============================================================================
CREATE SCHEMA IF NOT EXISTS cin_aux;

-- ============================================================================
-- 1) Control-plane sessions (UUID PK)  —— created FIRST
-- ============================================================================
CREATE TABLE IF NOT EXISTS cin_aux.sessions (
  session_id      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id   uuid NOT NULL REFERENCES auth."user"(user_id),
  -- Store window as text; optional FK added later via guarded block
  window_label    text NOT NULL,
  window_bins     int    NOT NULL CHECK (window_bins > 0),
  window_ms       bigint NOT NULL CHECK (window_ms > 0),

  -- lifecycle
  status          text NOT NULL DEFAULT 'open',  -- 'open' | 'closed' | 'error' | etc.
  meta            jsonb NOT NULL DEFAULT '{}'::jsonb,

  -- audit
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),

  -- stamps
  engine_cycle          int,
  cycle_index           bigint NOT NULL DEFAULT 0,
  opening_stamp         boolean NOT NULL DEFAULT false,
  opening_session_id    uuid,
  opening_ts            timestamptz,
  print_stamp           boolean NOT NULL DEFAULT false,
  print_ts              timestamptz
);

CREATE INDEX IF NOT EXISTS cin_sessions_window_idx
  ON cin_aux.sessions (window_label);

-- Backward compatible column adds
ALTER TABLE cin_aux.sessions
  ADD COLUMN IF NOT EXISTS owner_user_id uuid REFERENCES auth."user"(user_id);
ALTER TABLE cin_aux.sessions
  ADD COLUMN IF NOT EXISTS cycle_index bigint NOT NULL DEFAULT 0;
DO $$
BEGIN
  BEGIN
    ALTER TABLE cin_aux.sessions
      ALTER COLUMN owner_user_id SET NOT NULL;
  EXCEPTION
    WHEN others THEN
      -- existing rows without owner can be backfilled later; skip constraint
      NULL;
  END;
END$$;

-- Helpful indexes that require new columns
CREATE INDEX IF NOT EXISTS cin_sessions_ts_idx
  ON cin_aux.sessions (owner_user_id, created_at DESC);


-- Touch trigger for updated_at (local to cin_aux)
CREATE OR REPLACE FUNCTION cin_aux.touch_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'trg_cin_sessions_touch_updated_at'
  ) THEN
    CREATE TRIGGER trg_cin_sessions_touch_updated_at
      BEFORE UPDATE ON cin_aux.sessions
      FOR EACH ROW
      EXECUTE FUNCTION cin_aux.touch_updated_at();
  END IF;
END$$;

-- ============================================================================
-- 2) Global & per-session universes
-- ============================================================================
CREATE TABLE IF NOT EXISTS cin_aux.settings_coin_universe (
  symbol   text PRIMARY KEY,
  meta     jsonb NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT cin_coin_symbol_upper CHECK (symbol = upper(symbol))
);

CREATE TABLE IF NOT EXISTS cin_aux.session_coin_universe (
  session_id  uuid NOT NULL REFERENCES cin_aux.sessions(session_id) ON DELETE CASCADE,
  symbol      text NOT NULL REFERENCES cin_aux.settings_coin_universe(symbol) ON DELETE RESTRICT,
  PRIMARY KEY (session_id, symbol)
);

-- ============================================================================
-- 3) Matrix registry (per-session) and matrix cells
-- ============================================================================
CREATE TABLE IF NOT EXISTS cin_aux.mat_registry (
  mat_id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id    uuid NOT NULL REFERENCES cin_aux.sessions(session_id) ON DELETE CASCADE,
  name          text NOT NULL,                 -- matrix name: 'id_pct','pct_drv','ref','pct_ref','bm','elta',...
  symbol        text NOT NULL,                 -- e.g. BTCUSDT
  -- Keep text here; optional FK added later
  window_label  text NOT NULL,
  bins          int  NOT NULL CHECK (bins >= 0),
  meta          jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at    timestamptz NOT NULL DEFAULT now(),

  -- stamps inline
  engine_cycle          int,
  opening_stamp         boolean NOT NULL DEFAULT false,
  opening_session_id    uuid,
  opening_ts            timestamptz,
  print_stamp           boolean NOT NULL DEFAULT false,
  print_ts              timestamptz
);

CREATE INDEX IF NOT EXISTS idx_cin_matreg
  ON cin_aux.mat_registry(session_id, name, symbol);

CREATE TABLE IF NOT EXISTS cin_aux.mat_cell (
  mat_id  uuid NOT NULL REFERENCES cin_aux.mat_registry(mat_id) ON DELETE CASCADE,
  i       int  NOT NULL,
  j       int  NOT NULL,
  v       double precision NOT NULL,
  PRIMARY KEY (mat_id, i, j)
);

-- ============================================================================
-- 4) MEA results (per symbol, per session)
-- ============================================================================
CREATE TABLE IF NOT EXISTS cin_aux.mea_result (
  mea_id       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id   uuid NOT NULL REFERENCES cin_aux.sessions(session_id) ON DELETE CASCADE,
  symbol       text NOT NULL,
  value        double precision NOT NULL,
  components   jsonb NOT NULL DEFAULT '{}'::jsonb,  -- tiers, mood, bulk_per_coin, etc.
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE(session_id, symbol),

  -- stamps inline
  engine_cycle          int,
  opening_stamp         boolean NOT NULL DEFAULT false,
  opening_session_id    uuid,
  opening_ts            timestamptz,
  print_stamp           boolean NOT NULL DEFAULT false,
  print_ts              timestamptz
);

-- ============================================================================
-- 5) Guarded FKs to settings.windows (attach only if compatible)
--    We prefer column order: label → name → key, and only if it is text/varchar.
-- ============================================================================
DO $$
DECLARE
  win_rel_exists  boolean;
  col_name        text;
  col_type        text;
  chosen_col      text;
BEGIN
  SELECT EXISTS (
    SELECT 1
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'settings' AND c.relname = 'windows'
  ) INTO win_rel_exists;

  IF win_rel_exists THEN
    -- probe candidate columns in priority order
    FOR col_name IN SELECT unnest(ARRAY['label','name','key']) LOOP
      SELECT atttypid::regtype::text
        INTO col_type
      FROM pg_attribute
      WHERE attrelid = 'settings.windows'::regclass
        AND attname = col_name
        AND NOT attisdropped;

      IF col_type IN ('text','varchar','character varying') THEN
        chosen_col := col_name;
        EXIT;
      END IF;
    END LOOP;

    IF chosen_col IS NOT NULL THEN
      -- sessions.window_label → settings.windows.(chosen_col)
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'fk_cin_sessions_window'
          AND conrelid = 'cin_aux.sessions'::regclass
      ) THEN
        EXECUTE format(
          'ALTER TABLE cin_aux.sessions
             ADD CONSTRAINT fk_cin_sessions_window
             FOREIGN KEY (window_label)
             REFERENCES settings.windows(%I)
             ON UPDATE CASCADE ON DELETE RESTRICT',
          chosen_col
        );
      END IF;

      -- mat_registry.window_label → settings.windows.(chosen_col)
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'fk_cin_matreg_window'
          AND conrelid = 'cin_aux.mat_registry'::regclass
      ) THEN
        EXECUTE format(
          'ALTER TABLE cin_aux.mat_registry
             ADD CONSTRAINT fk_cin_matreg_window
             FOREIGN KEY (window_label)
             REFERENCES settings.windows(%I)
             ON UPDATE CASCADE ON DELETE RESTRICT',
          chosen_col
        );
      END IF;
    END IF; -- chosen_col found and type ok
  END IF;   -- settings.windows exists
END$$ LANGUAGE plpgsql;

COMMIT;
