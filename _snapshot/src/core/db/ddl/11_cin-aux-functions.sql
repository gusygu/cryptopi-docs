BEGIN;

-- ──────────────────────────────────────────────────────────────────────────────
-- Schema + enums
-- ──────────────────────────────────────────────────────────────────────────────
CREATE SCHEMA IF NOT EXISTS mea_dynamics;

DO $$
BEGIN
  PERFORM 1
  FROM pg_type t
  JOIN pg_namespace n ON n.oid = t.typnamespace
  WHERE n.nspname = 'mea_dynamics' AND t.typname = 'tier_name';

  IF NOT FOUND THEN
    CREATE TYPE mea_dynamics.tier_name AS ENUM ('S','A','B','C','D','E');
  END IF;
END$$;

-- ──────────────────────────────────────────────────────────────────────────────
-- Mood registry
-- ──────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS mea_dynamics.mood_registry (
  mood_id     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  mood_name   text UNIQUE NOT NULL,            -- e.g. 'GFM/VSwap v1'
  formula     text NOT NULL DEFAULT 'v1',
  buckets     jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- ──────────────────────────────────────────────────────────────────────────────
-- Cycle registry (cooled marker defines snapshot eligibility)
-- window_label: keep as text; we'll optionally FK to settings.windows via guard
-- ──────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS mea_dynamics.cycles (
  cycle_id       bigserial PRIMARY KEY,
  window_label   text NOT NULL,
  engine_cycle   int  NOT NULL,
  ts_started     timestamptz NOT NULL DEFAULT now(),
  ts_cooled      timestamptz,
  cooled         boolean NOT NULL DEFAULT false,
  selected_base  text NOT NULL,
  selected_quote text NOT NULL,
  coins          text[] NOT NULL,
  UNIQUE (window_label, engine_cycle)
);

-- ──────────────────────────────────────────────────────────────────────────────
-- Per-symbol MEA values produced during a cycle
-- Keep window_label text; optional FK to settings.windows added later
-- ──────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS mea_dynamics.mea_symbol (
  cycle_id      bigint NOT NULL REFERENCES mea_dynamics.cycles(cycle_id) ON DELETE CASCADE,
  symbol        text   NOT NULL REFERENCES market.symbols(symbol) ON UPDATE CASCADE,
  window_label  text   NOT NULL,
  ts            timestamptz NOT NULL,
  engine_cycle  int NOT NULL,
  wallet_value  numeric(38,18),
  mea_value     numeric(38,18) NOT NULL,
  tier          mea_dynamics.tier_name NOT NULL,
  mood_id       uuid REFERENCES mea_dynamics.mood_registry(mood_id) ON DELETE SET NULL,
  mood_name     text,
  -- stamps
  opening_stamp       boolean NOT NULL DEFAULT false,
  opening_session_id  uuid,
  opening_ts          timestamptz,
  print_stamp         boolean NOT NULL DEFAULT false,
  print_ts            timestamptz,
  PRIMARY KEY (cycle_id, symbol)
);

CREATE INDEX IF NOT EXISTS idx_mea_symbol_window
  ON mea_dynamics.mea_symbol(window_label, engine_cycle);
CREATE INDEX IF NOT EXISTS idx_mea_symbol_ts
  ON mea_dynamics.mea_symbol(ts DESC);

-- ──────────────────────────────────────────────────────────────────────────────
-- Cohesive page snapshot (one row per cooled cycle — the selected pair)
-- Keep window_label text; optional FK added later
-- ──────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS mea_dynamics.dynamics_snapshot (
  cycle_id       bigint PRIMARY KEY REFERENCES mea_dynamics.cycles(cycle_id) ON DELETE CASCADE,
  window_label   text NOT NULL,
  engine_cycle   int  NOT NULL,
  ts             timestamptz NOT NULL,
  -- selection at cool time
  base           text NOT NULL,
  quote          text NOT NULL,
  -- universe and candidates as displayed
  coins          text[] NOT NULL,
  candidates     text[] NOT NULL,
  -- asset identity panel (wallets, headline metrics, etc.)
  asset_identity jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- arbitrage rows (already filtered for candidates)
  arbitrage_rows jsonb NOT NULL DEFAULT '[]'::jsonb,
  -- STR-AUX measures for base/quote
  str_available  boolean NOT NULL DEFAULT false,
  str_measures   jsonb,
  -- MEA for base/quote + tier/mood
  mea_value      numeric(38,18),
  mea_tier       mea_dynamics.tier_name,
  mood_id        uuid REFERENCES mea_dynamics.mood_registry(mood_id) ON DELETE SET NULL,
  mood_name      text,
  -- stamps
  opening_stamp       boolean NOT NULL DEFAULT false,
  opening_session_id  uuid,
  opening_ts          timestamptz,
  print_stamp         boolean NOT NULL DEFAULT false,
  print_ts            timestamptz
);

CREATE INDEX IF NOT EXISTS idx_dynsnap_window
  ON mea_dynamics.dynamics_snapshot(window_label, engine_cycle);
CREATE INDEX IF NOT EXISTS idx_dynsnap_ts
  ON mea_dynamics.dynamics_snapshot(ts DESC);

-- ──────────────────────────────────────────────────────────────────────────────
-- Guarded optional FKs
--   A) opening_session_id → cin_aux.sessions(session_id) (uuid only)
--   B) window_label → settings.windows.(label|name|key) if present & text-like
-- ──────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  -- A) sessions
  sess_exists   boolean;
  sess_id_type  text;

  -- B) settings.windows
  win_exists    boolean;
  cand          text;
  cand_type     text;
  chosen_col    text;
BEGIN
  -- A) cin_aux.sessions (uuid only)
  SELECT EXISTS (
    SELECT 1 FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname='cin_aux' AND c.relname='sessions'
  ) INTO sess_exists;

  IF sess_exists THEN
    SELECT atttypid::regtype::text
      INTO sess_id_type
    FROM pg_attribute
    WHERE attrelid='cin_aux.sessions'::regclass
      AND attname='session_id'
      AND NOT attisdropped;

    IF sess_id_type = 'uuid' THEN
      -- mea_symbol
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

      -- dynamics_snapshot
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

  -- B) settings.windows
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
      -- cycles.window_label → settings.windows.(chosen)
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
    END IF; -- chosen_col
  END IF;   -- win_exists
END$$ LANGUAGE plpgsql;

-- ──────────────────────────────────────────────────────────────────────────────
-- Functions
-- ──────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION mea_dynamics.assert_cycle_cooled(p_cycle_id bigint)
RETURNS void
LANGUAGE plpgsql AS $$
DECLARE v_cooled boolean;
BEGIN
  SELECT cooled INTO v_cooled
  FROM mea_dynamics.cycles
  WHERE cycle_id = p_cycle_id;

  IF v_cooled IS DISTINCT FROM TRUE THEN
    RAISE EXCEPTION 'cycle % is not cooled yet', p_cycle_id
      USING HINT = 'Insert snapshot only after cycle cools';
  END IF;
END$$;

CREATE OR REPLACE FUNCTION mea_dynamics.upsert_dynamics_snapshot(
  p_cycle_id bigint,
  p_payload  jsonb
) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM mea_dynamics.assert_cycle_cooled(p_cycle_id);

  INSERT INTO mea_dynamics.dynamics_snapshot(
    cycle_id, window_label, engine_cycle, ts,
    base, quote, coins, candidates,
    asset_identity, arbitrage_rows, str_available, str_measures,
    mea_value, mea_tier, mood_id, mood_name,
    opening_stamp, opening_session_id, opening_ts, print_stamp, print_ts
  )
  VALUES (
    p_cycle_id,
    (p_payload->>'window_label'),
    NULLIF(p_payload->>'engine_cycle','')::int,
    NULLIF(p_payload->>'ts','')::timestamptz,
    (p_payload->>'base'),
    (p_payload->>'quote'),
    COALESCE( (SELECT ARRAY(SELECT jsonb_array_elements_text(p_payload->'coins'))), ARRAY[]::text[] ),
    COALESCE( (SELECT ARRAY(SELECT jsonb_array_elements_text(p_payload->'candidates'))), ARRAY[]::text[] ),
    COALESCE(p_payload->'asset_identity', '{}'::jsonb),
    COALESCE(p_payload->'arbitrage_rows', '[]'::jsonb),
    COALESCE((p_payload->>'str_available')::boolean, false),
    CASE WHEN (p_payload ? 'str_measures') THEN p_payload->'str_measures' ELSE NULL END,
    NULLIF(p_payload->>'mea_value','')::numeric,
    NULLIF(p_payload->>'mea_tier','')::mea_dynamics.tier_name,
    NULLIF(p_payload->>'mood_id','')::uuid,
    NULLIF(p_payload->>'mood_name',''),
    COALESCE((p_payload->>'opening_stamp')::boolean,false),
    NULLIF(p_payload->>'opening_session_id','')::uuid,
    NULLIF(p_payload->>'opening_ts','')::timestamptz,
    COALESCE((p_payload->>'print_stamp')::boolean,false),
    NULLIF(p_payload->>'print_ts','')::timestamptz
  )
  ON CONFLICT (cycle_id) DO UPDATE
  SET window_label   = EXCLUDED.window_label,
      engine_cycle   = EXCLUDED.engine_cycle,
      ts             = EXCLUDED.ts,
      base           = EXCLUDED.base,
      quote          = EXCLUDED.quote,
      coins          = EXCLUDED.coins,
      candidates     = EXCLUDED.candidates,
      asset_identity = EXCLUDED.asset_identity,
      arbitrage_rows = EXCLUDED.arbitrage_rows,
      str_available  = EXCLUDED.str_available,
      str_measures   = EXCLUDED.str_measures,
      mea_value      = EXCLUDED.mea_value,
      mea_tier       = EXCLUDED.mea_tier,
      mood_id        = EXCLUDED.mood_id,
      mood_name      = EXCLUDED.mood_name,
      opening_stamp  = EXCLUDED.opening_stamp,
      opening_session_id = EXCLUDED.opening_session_id,
      opening_ts     = EXCLUDED.opening_ts,
      print_stamp    = EXCLUDED.print_stamp,
      print_ts       = EXCLUDED.print_ts;
END$$;

CREATE OR REPLACE FUNCTION mea_dynamics.start_cycle(
  p_window_label text,
  p_engine_cycle int,
  p_base text,
  p_quote text,
  p_coins text[]
) RETURNS bigint
LANGUAGE plpgsql AS $$
DECLARE v_id bigint;
BEGIN
  INSERT INTO mea_dynamics.cycles(window_label, engine_cycle, selected_base, selected_quote, coins)
  VALUES (p_window_label, p_engine_cycle, p_base, p_quote, p_coins)
  ON CONFLICT (window_label, engine_cycle) DO NOTHING;

  SELECT cycle_id INTO v_id
  FROM mea_dynamics.cycles
  WHERE window_label = p_window_label
    AND engine_cycle = p_engine_cycle;

  RETURN v_id;
END$$;

CREATE OR REPLACE FUNCTION mea_dynamics.cool_cycle(
  p_window_label text,
  p_engine_cycle int
) RETURNS bigint
LANGUAGE plpgsql AS $$
DECLARE v_id bigint;
BEGIN
  UPDATE mea_dynamics.cycles
     SET cooled = true, ts_cooled = now()
   WHERE window_label = p_window_label
     AND engine_cycle = p_engine_cycle;

  SELECT cycle_id INTO v_id
  FROM mea_dynamics.cycles
  WHERE window_label = p_window_label
    AND engine_cycle = p_engine_cycle;

  RETURN v_id;
END$$;
