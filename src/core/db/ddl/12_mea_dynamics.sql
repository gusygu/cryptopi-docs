BEGIN;

-- =====================================================================
-- Preconditions: 09_cin-aux-functions.sql already created the schema
-- and base tables. This file adds indexes, views, and guarded FKs only.
-- =====================================================================

-- Be tolerant if 09 hasn't run yet; skip gracefully.
DO $$
BEGIN
  IF to_regclass('mea_dynamics.cycles') IS NULL THEN
    RAISE NOTICE 'mea_dynamics.cycles not found; skipping 10_mea_dynamics setup.';
    RETURN;
  END IF;
END$$;

-- =====================================================================
-- 1) Helpful indexes (idempotent)
-- =====================================================================
-- cycles fast lookups
CREATE INDEX IF NOT EXISTS idx_mea_cycles_window_cycle
  ON mea_dynamics.cycles (window_label, engine_cycle);
CREATE INDEX IF NOT EXISTS idx_mea_cycles_ts
  ON mea_dynamics.cycles (ts_started DESC);

-- mea_symbol already has (window_label,engine_cycle) & ts indexes from 09,
-- keep an extra symbol-only for scans:
CREATE INDEX IF NOT EXISTS idx_mea_symbol_symbol
  ON mea_dynamics.mea_symbol (symbol);

-- dynamics_snapshot already has window & ts indexes from 09;
-- add a base/quote scan helper
CREATE INDEX IF NOT EXISTS idx_dynsnap_pair
  ON mea_dynamics.dynamics_snapshot (base, quote);

-- =====================================================================
-- 2) “Latest” convenience views (read-only)
-- =====================================================================

-- Latest cooled cycle per window_label
CREATE OR REPLACE VIEW mea_dynamics.latest_cooled_cycle AS
SELECT DISTINCT ON (c.window_label)
  c.window_label,
  c.engine_cycle,
  c.cycle_id,
  c.ts_started,
  c.ts_cooled,
  c.selected_base AS base,
  c.selected_quote AS quote,
  c.coins,
  c.cooled
FROM mea_dynamics.cycles c
WHERE c.cooled IS TRUE
ORDER BY c.window_label, c.ts_cooled DESC, c.engine_cycle DESC;

-- Latest MEA values per symbol (across all windows), based on ts
CREATE OR REPLACE VIEW mea_dynamics.mea_latest_per_symbol AS
SELECT DISTINCT ON (m.symbol)
  m.symbol,
  m.window_label,
  m.engine_cycle,
  m.ts,
  m.mea_value,
  m.wallet_value,
  m.tier,
  m.mood_id,
  m.mood_name,
  m.opening_stamp,
  m.print_stamp,
  m.cycle_id
FROM mea_dynamics.mea_symbol m
ORDER BY m.symbol, m.ts DESC, m.cycle_id DESC;

-- Latest dynamics snapshot per window
CREATE OR REPLACE VIEW mea_dynamics.dynamics_latest AS
SELECT DISTINCT ON (d.window_label)
  d.window_label,
  d.engine_cycle,
  d.ts,
  d.base,
  d.quote,
  d.coins,
  d.candidates,
  d.asset_identity,
  d.arbitrage_rows,
  d.str_available,
  d.str_measures,
  d.mea_value,
  d.mea_tier,
  d.mood_id,
  d.mood_name,
  d.opening_stamp,
  d.print_stamp,
  d.cycle_id
FROM mea_dynamics.dynamics_snapshot d
ORDER BY d.window_label, d.ts DESC, d.engine_cycle DESC;

-- =====================================================================
-- 3) Guarded FK attachments (optional, safe on PG14)
--    A) opening_session_id → cin_aux.sessions(session_id) if uuid
--    B) window_label → settings.windows.(label|name|key) if text-like
-- =====================================================================

DO $$
DECLARE
  -- sessions
  sess_exists boolean;
  sess_type   text;

  -- settings.windows
  win_exists  boolean;
  cand        text;
  cand_type   text;
  chosen_col  text;
BEGIN
  -- A) cin_aux.sessions
  SELECT EXISTS (
    SELECT 1 FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname='cin_aux' AND c.relname='sessions'
  ) INTO sess_exists;

  IF sess_exists THEN
    SELECT atttypid::regtype::text
      INTO sess_type
    FROM pg_attribute
    WHERE attrelid='cin_aux.sessions'::regclass
      AND attname='session_id'
      AND NOT attisdropped;

    IF sess_type = 'uuid' THEN
      -- mea_symbol.opening_session_id
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname='fk_mea_symbol_opening_session'
          AND conrelid='mea_dynamics.mea_symbol'::regclass
      ) THEN
        ALTER TABLE mea_dynamics.mea_symbol
          ADD CONSTRAINT fk_mea_symbol_opening_session
          FOREIGN KEY (opening_session_id)
          REFERENCES cin_aux.sessions(session_id)
          ON DELETE SET NULL;
      END IF;

      -- dynamics_snapshot.opening_session_id
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname='fk_dynsnap_opening_session'
          AND conrelid='mea_dynamics.dynamics_snapshot'::regclass
      ) THEN
        ALTER TABLE mea_dynamics.dynamics_snapshot
          ADD CONSTRAINT fk_dynsnap_opening_session
          FOREIGN KEY (opening_session_id)
          REFERENCES cin_aux.sessions(session_id)
          ON DELETE SET NULL;
      END IF;
    END IF;
  END IF;

  -- B) settings.windows (text-like column: label|name|key)
  SELECT EXISTS (
    SELECT 1 FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname='settings' AND c.relname='windows'
  ) INTO win_exists;

  IF win_exists THEN
    FOR cand IN SELECT unnest(ARRAY['label','name','key']) LOOP
      SELECT atttypid::regtype::text
        INTO cand_type
      FROM pg_attribute
      WHERE attrelid='settings.windows'::regclass
        AND attname=cand
        AND NOT attisdropped;

      IF cand_type IN ('text','varchar','character varying') THEN
        chosen_col := cand;
        EXIT;
      END IF;
    END LOOP;

    IF chosen_col IS NOT NULL THEN
      -- cycles.window_label
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname='fk_mea_cycles_window'
          AND conrelid='mea_dynamics.cycles'::regclass
      ) THEN
        EXECUTE format(
          'ALTER TABLE mea_dynamics.cycles
             ADD CONSTRAINT fk_mea_cycles_window
             FOREIGN KEY (window_label)
             REFERENCES settings.windows(%I)
             ON UPDATE CASCADE ON DELETE RESTRICT',
          chosen_col
        );
      END IF;

      -- mea_symbol.window_label
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname='fk_mea_symbol_window'
          AND conrelid='mea_dynamics.mea_symbol'::regclass
      ) THEN
        EXECUTE format(
          'ALTER TABLE mea_dynamics.mea_symbol
             ADD CONSTRAINT fk_mea_symbol_window
             FOREIGN KEY (window_label)
             REFERENCES settings.windows(%I)
             ON UPDATE CASCADE ON DELETE RESTRICT',
          chosen_col
        );
      END IF;

      -- dynamics_snapshot.window_label
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname='fk_dynsnap_window'
          AND conrelid='mea_dynamics.dynamics_snapshot'::regclass
      ) THEN
        EXECUTE format(
          'ALTER TABLE mea_dynamics.dynamics_snapshot
             ADD CONSTRAINT fk_dynsnap_window
             FOREIGN KEY (window_label)
             REFERENCES settings.windows(%I)
             ON UPDATE CASCADE ON DELETE RESTRICT',
          chosen_col
        );
      END IF;
    END IF;
  END IF;
END$$ LANGUAGE plpgsql;

COMMIT;
