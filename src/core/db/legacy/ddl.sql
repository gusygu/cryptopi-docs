-- CryptoPi Dynamics • Unified DDL (PostgreSQL ≥ 13)
-- Idempotent: safe to run multiple times.

BEGIN;

SET client_min_messages TO WARNING;
CREATE SCHEMA IF NOT EXISTS strategy_aux;
CREATE SCHEMA IF NOT EXISTS strategy_aux;

-- ensure schema exists
CREATE SCHEMA IF NOT EXISTS strategy_aux;

-- ── Foundation: core schema + app_sessions ─────────────────────────────────────
SET client_min_messages TO WARNING;

-- Choose a home schema for app tables; I'm using 'cp' (change if you prefer 'public')
CREATE SCHEMA IF NOT EXISTS cp;

-- Create the app_sessions table if missing (minimal columns to satisfy FKs; extend as needed)
CREATE TABLE IF NOT EXISTS cp.app_sessions (
  app_session_id TEXT PRIMARY KEY,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  status         TEXT NOT NULL DEFAULT 'active'
);

-- Make sure search_path is friendly during this run
SET search_path = cp, strategy_aux, public;


DO $$
BEGIN
  -- If the table doesn't exist, create it fully
  IF to_regclass('strategy_aux.str_aux_session') IS NULL THEN
    CREATE TABLE strategy_aux.str_aux_session (
      id                BIGSERIAL PRIMARY KEY,
      pair_base         TEXT NOT NULL,
      pair_quote        TEXT NOT NULL DEFAULT 'USDT',
      window_key        TEXT NOT NULL,
      app_session_id    TEXT NOT NULL REFERENCES app_sessions(app_session_id) ON DELETE CASCADE,

      opening_stamp     BOOLEAN NOT NULL DEFAULT FALSE,
      opening_ts        BIGINT,
      opening_price     DOUBLE PRECISION,

      price_min         DOUBLE PRECISION,
      price_max         DOUBLE PRECISION,
      bench_pct_min     DOUBLE PRECISION NOT NULL DEFAULT 0,
      bench_pct_max     DOUBLE PRECISION NOT NULL DEFAULT 0,

      last_update_ms    BIGINT,

      -- counters / state
      shifts            INTEGER NOT NULL DEFAULT 0,
      swaps             INTEGER NOT NULL DEFAULT 0,
      ui_epoch          INTEGER NOT NULL DEFAULT 0,
      above_count       INTEGER NOT NULL DEFAULT 0,
      below_count       INTEGER NOT NULL DEFAULT 0,
      shift_stamp       BOOLEAN NOT NULL DEFAULT FALSE,

      -- GFM anchors / last marks
      gfm_anchor_price      DOUBLE PRECISION,
      gfm_calc_price_last   DOUBLE PRECISION,
      gfm_r_last            DOUBLE PRECISION,
      gfm_delta_last        DOUBLE PRECISION,

      last_price        DOUBLE PRECISION,

      -- natural key used by upsert_str_aux_opening
      CONSTRAINT uq_str_aux_session_key
        UNIQUE (pair_base, pair_quote, window_key, app_session_id)
    );

  ELSE
    -- Table exists (likely the 1-column stub). Upgrade it in place.
    -- 1) Add missing columns
    ALTER TABLE strategy_aux.str_aux_session
      ADD COLUMN IF NOT EXISTS pair_base           TEXT,
      ADD COLUMN IF NOT EXISTS pair_quote          TEXT DEFAULT 'USDT',
      ADD COLUMN IF NOT EXISTS window_key          TEXT,
      ADD COLUMN IF NOT EXISTS app_session_id      TEXT,
      ADD COLUMN IF NOT EXISTS opening_stamp       BOOLEAN DEFAULT FALSE,
      ADD COLUMN IF NOT EXISTS opening_ts          BIGINT,
      ADD COLUMN IF NOT EXISTS opening_price       DOUBLE PRECISION,
      ADD COLUMN IF NOT EXISTS price_min           DOUBLE PRECISION,
      ADD COLUMN IF NOT EXISTS price_max           DOUBLE PRECISION,
      ADD COLUMN IF NOT EXISTS bench_pct_min       DOUBLE PRECISION DEFAULT 0,
      ADD COLUMN IF NOT EXISTS bench_pct_max       DOUBLE PRECISION DEFAULT 0,
      ADD COLUMN IF NOT EXISTS last_update_ms      BIGINT,
      ADD COLUMN IF NOT EXISTS shifts              INTEGER DEFAULT 0,
      ADD COLUMN IF NOT EXISTS swaps               INTEGER DEFAULT 0,
      ADD COLUMN IF NOT EXISTS ui_epoch            INTEGER DEFAULT 0,
      ADD COLUMN IF NOT EXISTS above_count         INTEGER DEFAULT 0,
      ADD COLUMN IF NOT EXISTS below_count         INTEGER DEFAULT 0,
      ADD COLUMN IF NOT EXISTS shift_stamp         BOOLEAN DEFAULT FALSE,
      ADD COLUMN IF NOT EXISTS gfm_anchor_price    DOUBLE PRECISION,
      ADD COLUMN IF NOT EXISTS gfm_calc_price_last DOUBLE PRECISION,
      ADD COLUMN IF NOT EXISTS gfm_r_last          DOUBLE PRECISION,
      ADD COLUMN IF NOT EXISTS gfm_delta_last      DOUBLE PRECISION,
      ADD COLUMN IF NOT EXISTS last_price          DOUBLE PRECISION;

    -- 2) Backfill safe defaults (only if any rows exist)
    UPDATE strategy_aux.str_aux_session
       SET pair_quote   = COALESCE(pair_quote, 'USDT'),
           bench_pct_min= COALESCE(bench_pct_min, 0),
           bench_pct_max= COALESCE(bench_pct_max, 0),
           opening_stamp= COALESCE(opening_stamp, FALSE),
           shifts       = COALESCE(shifts, 0),
           swaps        = COALESCE(swaps, 0),
           ui_epoch     = COALESCE(ui_epoch, 0),
           above_count  = COALESCE(above_count, 0),
           below_count  = COALESCE(below_count, 0),
           shift_stamp  = COALESCE(shift_stamp, FALSE)
     WHERE TRUE;

    -- 3) Enforce NOT NULLs now that defaults are in place
    ALTER TABLE strategy_aux.str_aux_session
      ALTER COLUMN pair_base     SET NOT NULL,
      ALTER COLUMN pair_quote    SET NOT NULL,
      ALTER COLUMN window_key    SET NOT NULL,
      ALTER COLUMN app_session_id SET NOT NULL,
      ALTER COLUMN bench_pct_min SET NOT NULL,
      ALTER COLUMN bench_pct_max SET NOT NULL,
      ALTER COLUMN shifts        SET NOT NULL,
      ALTER COLUMN swaps         SET NOT NULL,
      ALTER COLUMN ui_epoch      SET NOT NULL,
      ALTER COLUMN above_count   SET NOT NULL,
      ALTER COLUMN below_count   SET NOT NULL,
      ALTER COLUMN shift_stamp   SET NOT NULL;

    -- 4) FK for app_session_id
    DO $inner$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid = 'strategy_aux.str_aux_session'::regclass
          AND contype = 'f'
      ) THEN
        ALTER TABLE strategy_aux.str_aux_session
          ADD CONSTRAINT str_aux_session_app_session_fk
          FOREIGN KEY (app_session_id)
          REFERENCES app_sessions(app_session_id)
          ON DELETE CASCADE;
      END IF;
    END $inner$;

    -- 5) Unique constraint for natural key (if missing)
    DO $inner$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'uq_str_aux_session_key'
      ) THEN
        ALTER TABLE strategy_aux.str_aux_session
          ADD CONSTRAINT uq_str_aux_session_key
          UNIQUE (pair_base, pair_quote, window_key, app_session_id);
      END IF;
    END $inner$;

  END IF;
END$$;

-- The lookup index can stay (redundant with UNIQUE, but harmless)
CREATE INDEX IF NOT EXISTS idx_str_aux_session_lookup
  ON strategy_aux.str_aux_session (pair_base, pair_quote, window_key, app_session_id);


-- =========================
-- 0) PRELUDE / EXTENSIONS
-- =========================
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Schemas
CREATE SCHEMA IF NOT EXISTS public;
CREATE SCHEMA IF NOT EXISTS strategy_aux;

SET search_path TO public, strategy_aux;

-- =========================
-- 1) SYSTEM / SETTINGS
-- =========================
CREATE TABLE IF NOT EXISTS app_sessions (
  app_session_id text PRIMARY KEY,
  started_at     timestamptz NOT NULL DEFAULT now()
);

-- helper: guarantee session row (prevents FK breaks)
CREATE OR REPLACE FUNCTION ensure_app_session(p_app_session_id text)
RETURNS void LANGUAGE sql AS $$
  INSERT INTO app_sessions(app_session_id) VALUES (p_app_session_id)
  ON CONFLICT (app_session_id) DO NOTHING;
$$;

-- full JSON settings per app_session_id
CREATE TABLE IF NOT EXISTS app_session_settings (
  app_session_id text PRIMARY KEY
    REFERENCES app_sessions(app_session_id) ON DELETE CASCADE,
  payload    jsonb       NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- stamp/head: “settings applied”
CREATE TABLE IF NOT EXISTS app_session_settings_head (
  app_session_id   text PRIMARY KEY
    REFERENCES app_sessions(app_session_id) ON DELETE CASCADE,
  settings_applied boolean    NOT NULL DEFAULT false,
  applied_at       timestamptz,
  updated_at       timestamptz NOT NULL DEFAULT now()
);

-- upsert settings (self-healing via ensure_app_session)
CREATE OR REPLACE FUNCTION upsert_app_session_settings(
  p_app_session_id text,
  p_payload jsonb
) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM ensure_app_session(p_app_session_id);

  INSERT INTO app_session_settings(app_session_id, payload)
  VALUES (p_app_session_id, COALESCE(p_payload,'{}'::jsonb))
  ON CONFLICT (app_session_id) DO UPDATE
    SET payload = EXCLUDED.payload, updated_at = now();
END$$;

-- apply settings (+ stamp head)
CREATE OR REPLACE FUNCTION apply_session_settings(
  p_app_session_id text,
  p_payload jsonb,
  p_stamp boolean DEFAULT true
) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM ensure_app_session(p_app_session_id);

  INSERT INTO app_session_settings(app_session_id, payload)
  VALUES (p_app_session_id, COALESCE(p_payload,'{}'::jsonb))
  ON CONFLICT (app_session_id) DO UPDATE
    SET payload = EXCLUDED.payload, updated_at = now();

  INSERT INTO app_session_settings_head(app_session_id, settings_applied, applied_at)
  VALUES (p_app_session_id, p_stamp, CASE WHEN p_stamp THEN now() END)
  ON CONFLICT (app_session_id) DO UPDATE
    SET settings_applied = p_stamp,
        applied_at = CASE WHEN p_stamp THEN now() ELSE app_session_settings_head.applied_at END,
        updated_at = now();
END$$;

-- small refs + cycle clock
CREATE TABLE IF NOT EXISTS coins ( symbol text PRIMARY KEY );
CREATE TABLE IF NOT EXISTS pairs (
  base  text NOT NULL REFERENCES coins(symbol),
  quote text NOT NULL REFERENCES coins(symbol),
  PRIMARY KEY (base, quote)
);
CREATE TABLE IF NOT EXISTS cycles (
  cycle_ts   bigint PRIMARY KEY,  -- epoch ms
  created_at timestamptz NOT NULL DEFAULT now()
);

-- =========================
-- 2) METADATA / LEDGERS
-- =========================
-- low-friction app/system ledger (one table, use topic='matrices'|'mea'|'cin'|'str'|'api'...)
CREATE TABLE IF NOT EXISTS app_ledger (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  topic            text NOT NULL,
  event            text NOT NULL,
  payload          jsonb,
  session_id       text,
  idempotency_key  text UNIQUE,
  ts_epoch_ms      bigint NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now()
);

-- per-cycle JSON “documents” for audits/smokes
CREATE TABLE IF NOT EXISTS cycle_documents (
  domain           text        NOT NULL CHECK (domain IN ('matrices','mea','cin','str')),
  app_session_id   text        NOT NULL,
  cycle_ts         bigint      NOT NULL,
  payload          jsonb       NOT NULL,
  pairs_count      int,
  rows_count       int,
  notes            text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (domain, app_session_id, cycle_ts)
);
CREATE INDEX IF NOT EXISTS idx_cycle_documents_latest
  ON cycle_documents (domain, app_session_id, cycle_ts DESC);
CREATE INDEX IF NOT EXISTS idx_cycle_documents_payload_gin
  ON cycle_documents USING gin (payload);

CREATE OR REPLACE FUNCTION upsert_cycle_document(
  p_domain         text,
  p_app_session_id text,
  p_cycle_ts       bigint,
  p_payload        jsonb,
  p_pairs_count    int DEFAULT NULL,
  p_rows_count     int DEFAULT NULL,
  p_notes          text DEFAULT NULL
) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO cycle_documents(domain, app_session_id, cycle_ts, payload, pairs_count, rows_count, notes)
  VALUES (p_domain, p_app_session_id, p_cycle_ts, COALESCE(p_payload,'{}'::jsonb), p_pairs_count, p_rows_count, p_notes)
  ON CONFLICT (domain, app_session_id, cycle_ts)
  DO UPDATE SET payload=EXCLUDED.payload, pairs_count=EXCLUDED.pairs_count, rows_count=EXCLUDED.rows_count, notes=EXCLUDED.notes, created_at=now();
END$$;

CREATE OR REPLACE VIEW v_cycle_documents_latest AS
SELECT DISTINCT ON (domain, app_session_id)
       domain, app_session_id, cycle_ts, payload, created_at, pairs_count, rows_count, notes
FROM cycle_documents
ORDER BY domain, app_session_id, cycle_ts DESC;

-- =========================
-- 3) MATRICES
-- =========================
CREATE TABLE IF NOT EXISTS dyn_matrix_values (
  ts_ms        BIGINT           NOT NULL,
  matrix_type  TEXT             NOT NULL CHECK (matrix_type IN ('benchmark','delta','pct24h','id_pct','pct_drv','ref','pct_ref')),
  base         TEXT             NOT NULL,
  quote        TEXT             NOT NULL,
  value        DOUBLE PRECISION NOT NULL,
  meta         JSONB            NOT NULL DEFAULT '{}'::jsonb,
  PRIMARY KEY (ts_ms, matrix_type, base, quote)
);
CREATE INDEX IF NOT EXISTS dyn_mv_idx_pair
  ON dyn_matrix_values (matrix_type, base, quote, ts_ms DESC);

-- consistent latest slice per type (prevents mixed-ts coloring)
CREATE OR REPLACE VIEW v_dyn_matrix_latest AS
WITH latest AS (
  SELECT matrix_type, MAX(ts_ms) AS ts
  FROM dyn_matrix_values
  GROUP BY matrix_type
)
SELECT d.*
FROM dyn_matrix_values d
JOIN latest l
  ON d.matrix_type = l.matrix_type
 AND d.ts_ms       = l.ts;

CREATE OR REPLACE VIEW v_dyn_matrix_latest_by_pair AS
SELECT matrix_type, base, quote, value, meta
FROM v_dyn_matrix_latest;

-- writer + app_ledger log
CREATE OR REPLACE FUNCTION upsert_dyn_matrix_value(
  p_ts_ms BIGINT, p_type TEXT, p_base TEXT, p_quote TEXT,
  p_value DOUBLE PRECISION, p_meta JSONB, p_session_id TEXT, p_idem TEXT
) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO dyn_matrix_values(ts_ms, matrix_type, base, quote, value, meta)
  VALUES (p_ts_ms, p_type, p_base, p_quote, p_value, COALESCE(p_meta,'{}'::jsonb))
  ON CONFLICT (ts_ms, matrix_type, base, quote)
  DO UPDATE SET value = EXCLUDED.value, meta = EXCLUDED.meta;

  INSERT INTO app_ledger(topic, event, payload, session_id, idempotency_key, ts_epoch_ms)
  VALUES ('matrices','upsert',
          jsonb_build_object('ts_ms',p_ts_ms,'type',p_type,'base',p_base,'quote',p_quote,'value',p_value),
          p_session_id, p_idem, p_ts_ms)
  ON CONFLICT (idempotency_key) DO NOTHING;
END$$;

-- =========================
-- 4) MEA
-- =========================
CREATE TABLE IF NOT EXISTS mea_orientations (
  cycle_ts bigint NOT NULL REFERENCES cycles(cycle_ts),
  base     text   NOT NULL REFERENCES coins(symbol),
  quote    text   NOT NULL REFERENCES coins(symbol),
  metric   text   NOT NULL DEFAULT 'id_pct',
  value    double precision NOT NULL,
  PRIMARY KEY (cycle_ts, base, quote, metric)
);

CREATE TABLE IF NOT EXISTS mea_aux_snapshots (
  id             BIGSERIAL PRIMARY KEY,
  app_session_id TEXT   NOT NULL REFERENCES app_sessions(app_session_id) ON DELETE CASCADE,
  base           TEXT   NOT NULL REFERENCES coins(symbol),
  quote          TEXT   NOT NULL REFERENCES coins(symbol),
  window_key     TEXT   NOT NULL DEFAULT '1h',
  cycle_ts       BIGINT NOT NULL REFERENCES cycles(cycle_ts),
  payload        JSONB  NOT NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (app_session_id, base, quote, window_key, cycle_ts)
);
CREATE INDEX IF NOT EXISTS mea_aux_snapshots_lookup
  ON mea_aux_snapshots (app_session_id, base, quote, window_key, cycle_ts DESC);

CREATE OR REPLACE VIEW v_mea_aux_summary AS
SELECT base, quote, window_key, COUNT(*) AS samples, MAX(cycle_ts) AS last_cycle_ts
FROM mea_aux_snapshots
GROUP BY 1,2,3;

-- cycle doc helper (MEA)
CREATE OR REPLACE FUNCTION upsert_mea_cycle_doc(
  p_app_session_id text,
  p_cycle_ts bigint,
  p_payload jsonb,
  p_pairs_count int DEFAULT NULL,
  p_rows_count int DEFAULT NULL,
  p_notes text DEFAULT NULL
) RETURNS void LANGUAGE sql AS $$
  INSERT INTO cycle_documents(domain, app_session_id, cycle_ts, payload, pairs_count, rows_count, notes)
  VALUES ('mea', p_app_session_id, p_cycle_ts, COALESCE(p_payload,'{}'::jsonb), p_pairs_count, p_rows_count, p_notes)
  ON CONFLICT (domain, app_session_id, cycle_ts)
  DO UPDATE SET payload=EXCLUDED.payload, pairs_count=EXCLUDED.pairs_count, rows_count=EXCLUDED.rows_count, notes=EXCLUDED.notes, created_at=now();
$$;

-- =========================
-- 5) CIN
-- =========================
CREATE TABLE IF NOT EXISTS cin_aux_cycle (
  app_session_id        text   NOT NULL REFERENCES app_sessions(app_session_id),
  cycle_ts              bigint NOT NULL REFERENCES cycles(cycle_ts),
  symbol                text   NOT NULL REFERENCES coins(symbol),
  wallet_usdt           double precision NOT NULL,
  profit_usdt           double precision NOT NULL DEFAULT 0,
  imprint_cycle_usdt    double precision NOT NULL DEFAULT 0,
  luggage_cycle_usdt    double precision NOT NULL DEFAULT 0,
  PRIMARY KEY (app_session_id, cycle_ts, symbol)
);
CREATE INDEX IF NOT EXISTS idx_cin_aux_cycle_session_ts
  ON cin_aux_cycle (app_session_id, cycle_ts DESC);

CREATE TABLE IF NOT EXISTS cin_aux_session_acc (
  app_session_id     text NOT NULL REFERENCES app_sessions(app_session_id),
  symbol             text NOT NULL REFERENCES coins(symbol),
  imprint_acc_usdt   double precision NOT NULL DEFAULT 0,
  luggage_acc_usdt   double precision NOT NULL DEFAULT 0,
  PRIMARY KEY (app_session_id, symbol)
);

CREATE OR REPLACE VIEW v_cin_aux AS
SELECT
  c.app_session_id, c.cycle_ts, c.symbol, c.wallet_usdt, c.profit_usdt,
  c.imprint_cycle_usdt, c.luggage_cycle_usdt,
  COALESCE(a.imprint_acc_usdt, 0) AS imprint_app_session_usdt,
  COALESCE(a.luggage_acc_usdt, 0) AS luggage_app_session_usdt
FROM cin_aux_cycle c
LEFT JOIN cin_aux_session_acc a
  ON a.app_session_id = c.app_session_id
 AND a.symbol        = c.symbol;

-- cycle doc helper (CIN)
CREATE OR REPLACE FUNCTION upsert_cin_cycle_doc(
  p_app_session_id text,
  p_cycle_ts bigint,
  p_payload jsonb,
  p_pairs_count int DEFAULT NULL,
  p_rows_count int DEFAULT NULL,
  p_notes text DEFAULT NULL
) RETURNS void LANGUAGE sql AS $$
  INSERT INTO cycle_documents(domain, app_session_id, cycle_ts, payload, pairs_count, rows_count, notes)
  VALUES ('cin', p_app_session_id, p_cycle_ts, COALESCE(p_payload,'{}'::jsonb), p_pairs_count, p_rows_count, p_notes)
  ON CONFLICT (domain, app_session_id, cycle_ts)
  DO UPDATE SET payload=EXCLUDED.payload, pairs_count=EXCLUDED.pairs_count, rows_count=EXCLUDED.rows_count, notes=EXCLUDED.notes, created_at=now();
$$;

-- =========================
-- 6) STR (sessions + events + opening/reset)
-- =========================
-- assume table exists with your live shape; just ensure lookup index
CREATE INDEX IF NOT EXISTS idx_str_aux_session_lookup
  ON strategy_aux.str_aux_session (pair_base, pair_quote, window_key, app_session_id);

-- events (opening | swap | shift)
CREATE TABLE IF NOT EXISTS strategy_aux.str_aux_event (
  id           BIGSERIAL PRIMARY KEY,
  session_id   BIGINT NOT NULL REFERENCES strategy_aux.str_aux_session(id) ON DELETE CASCADE,
  kind         TEXT NOT NULL,
  payload      JSONB,
  created_ms   BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_str_aux_event_session
  ON strategy_aux.str_aux_event (session_id, created_ms DESC);

-- opening upsert — matches your CURRENT columns (no eta_pct in table)
CREATE OR REPLACE FUNCTION upsert_str_aux_opening(
  p_base TEXT, p_quote TEXT, p_window TEXT, p_app_session_id TEXT,
  p_opening_ts BIGINT, p_opening_price DOUBLE PRECISION,
  p_idem TEXT
) RETURNS BIGINT AS $$
DECLARE v_id BIGINT;
BEGIN
  PERFORM ensure_app_session(p_app_session_id);

  INSERT INTO strategy_aux.str_aux_session(
    pair_base, pair_quote, window_key, app_session_id,
    opening_stamp, opening_ts, opening_price,
    price_min, price_max, bench_pct_min, bench_pct_max,
    last_update_ms,
    -- full reset
    shifts, swaps, ui_epoch, above_count, below_count, shift_stamp,
    gfm_anchor_price, gfm_calc_price_last, gfm_r_last, gfm_delta_last,
    last_price
  ) VALUES (
    p_base, COALESCE(p_quote,'USDT'), p_window, p_app_session_id,
    TRUE, p_opening_ts, p_opening_price,
    p_opening_price, p_opening_price, 0, 0,
    p_opening_ts,
    0, 0, 0, 0, 0, FALSE,
    p_opening_price, NULL, NULL, NULL,
    p_opening_price
  )
  ON CONFLICT (pair_base, pair_quote, window_key, app_session_id)
  DO UPDATE SET
    opening_stamp  = TRUE,
    opening_ts     = EXCLUDED.opening_ts,
    opening_price  = EXCLUDED.opening_price,
    price_min      = EXCLUDED.opening_price,
    price_max      = EXCLUDED.opening_price,
    bench_pct_min  = 0,
    bench_pct_max  = 0,
    last_update_ms = EXCLUDED.last_update_ms,
    shifts         = 0, swaps = 0, ui_epoch = 0,
    above_count    = 0, below_count = 0, shift_stamp = FALSE,
    gfm_anchor_price    = EXCLUDED.opening_price,
    gfm_calc_price_last = NULL,
    gfm_r_last          = NULL,
    gfm_delta_last      = NULL,
    last_price          = EXCLUDED.opening_price
  RETURNING id INTO v_id;

  INSERT INTO app_ledger(topic, event, payload, session_id, idempotency_key, ts_epoch_ms)
  VALUES ('str','opening_set',
          jsonb_build_object('str_session_id',v_id,'base',p_base,'quote',p_quote,'window',p_window,
                             'opening_ts',p_opening_ts,'opening_price',p_opening_price),
          p_app_session_id, p_idem, p_opening_ts)
  ON CONFLICT (idempotency_key) DO NOTHING;

  RETURN v_id;
END;
$$ LANGUAGE plpgsql;

-- optional: hard reset helper for an existing STR row
CREATE OR REPLACE FUNCTION str_aux_reset_row(p_id BIGINT)
RETURNS void LANGUAGE sql AS $$
  UPDATE strategy_aux.str_aux_session
  SET shifts=0, swaps=0, ui_epoch=0,
      above_count=0, below_count=0, shift_stamp=FALSE,
      gfm_calc_price_last=NULL, gfm_r_last=NULL, gfm_delta_last=NULL,
      price_min=opening_price, price_max=opening_price,
      bench_pct_min=0, bench_pct_max=0,
      last_price=opening_price
  WHERE id = p_id;
$$;

-- cycle doc helper (STR)
CREATE OR REPLACE FUNCTION upsert_str_cycle_doc(
  p_app_session_id text,
  p_cycle_ts bigint,
  p_payload jsonb,
  p_pairs_count int DEFAULT NULL,
  p_rows_count int DEFAULT NULL,
  p_notes text DEFAULT NULL
) RETURNS void LANGUAGE sql AS $$
  INSERT INTO cycle_documents(domain, app_session_id, cycle_ts, payload, pairs_count, rows_count, notes)
  VALUES ('str', p_app_session_id, p_cycle_ts, COALESCE(p_payload,'{}'::jsonb), p_pairs_count, p_rows_count, p_notes)
  ON CONFLICT (domain, app_session_id, cycle_ts)
  DO UPDATE SET payload=EXCLUDED.payload, pairs_count=EXCLUDED.pairs_count, rows_count=EXCLUDED.rows_count, notes=EXCLUDED.notes, created_at=now();
$$;

-- =========================
-- 7) ROLES / PERMISSIONS
-- =========================
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='cp_owner')  THEN CREATE ROLE cp_owner  NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='cp_writer') THEN CREATE ROLE cp_writer NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='cp_app')    THEN CREATE ROLE cp_app    NOLOGIN; END IF;
END$$;

GRANT USAGE ON SCHEMA public, strategy_aux TO cp_app, cp_writer;

-- read for app/writer
GRANT SELECT ON ALL TABLES    IN SCHEMA public, strategy_aux TO cp_app, cp_writer;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public, strategy_aux TO cp_app, cp_writer;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public, strategy_aux TO cp_app, cp_writer;

-- writes for writer
GRANT INSERT, UPDATE ON dyn_matrix_values            TO cp_writer;
GRANT INSERT, UPDATE ON cin_aux_session_acc          TO cp_writer;
GRANT INSERT          ON cin_aux_cycle               TO cp_writer;
GRANT INSERT          ON mea_orientations            TO cp_writer;
GRANT INSERT, UPDATE ON cycle_documents              TO cp_writer;
GRANT INSERT, UPDATE ON strategy_aux.str_aux_session TO cp_writer;
GRANT INSERT          ON strategy_aux.str_aux_event  TO cp_writer;

-- app can log
GRANT INSERT ON app_ledger TO cp_app;

-- default privileges for future objects by cp_owner
ALTER DEFAULT PRIVILEGES FOR ROLE cp_owner IN SCHEMA public
  GRANT SELECT ON TABLES TO cp_app, cp_writer;
ALTER DEFAULT PRIVILEGES FOR ROLE cp_owner IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO cp_app, cp_writer;
ALTER DEFAULT PRIVILEGES FOR ROLE cp_owner IN SCHEMA public
  GRANT EXECUTE ON FUNCTIONS TO cp_app, cp_writer;

ALTER DEFAULT PRIVILEGES FOR ROLE cp_owner IN SCHEMA strategy_aux
  GRANT SELECT ON TABLES TO cp_app, cp_writer;
ALTER DEFAULT PRIVILEGES FOR ROLE cp_owner IN SCHEMA strategy_aux
  GRANT USAGE, SELECT ON SEQUENCES TO cp_app, cp_writer;
ALTER DEFAULT PRIVILEGES FOR ROLE cp_owner IN SCHEMA strategy_aux
  GRANT EXECUTE ON FUNCTIONS TO cp_app, cp_writer;

COMMIT;


-- =========================
-- 8) MATRICES GRID REGISTRATION PACK
-- =========================

BEGIN;

-- 1) Staging table: writer dumps the whole slice here first.
--    One row per cell (BASE, QUOTE) for a given matrix_type and ts_ms.
CREATE TABLE IF NOT EXISTS public.dyn_matrix_values_stage (
  ts_ms        BIGINT           NOT NULL,
  matrix_type  TEXT             NOT NULL,    -- 'benchmark','delta','id_pct','pct_drv','pct24h','ref','pct_ref',...
  base         TEXT             NOT NULL,
  quote        TEXT             NOT NULL,
  value        DOUBLE PRECISION NOT NULL,
  meta         JSONB            NOT NULL DEFAULT '{}'::jsonb,
  app_session_id TEXT,                         -- who prepared this slice (optional but helpful)
  created_at   TIMESTAMPTZ      NOT NULL DEFAULT now(),
  PRIMARY KEY (ts_ms, matrix_type, base, quote)
);

-- 2) Helper view: count pairs in stage for a given (ts, type)
CREATE OR REPLACE VIEW public.v_dyn_mv_stage_counts AS
SELECT ts_ms, matrix_type, COUNT(*) AS cells
FROM public.dyn_matrix_values_stage
GROUP BY 1,2;

-- 3) Commit function:
--    - Validates completeness vs expected coins (from settings by default)
--    - Publishes the stage rows into dyn_matrix_values (UPSERT)
--    - Writes a cycle_document('matrices', ...)
--    - Logs to app_ledger once
CREATE OR REPLACE FUNCTION public.commit_matrix_grid(
  p_app_session_id TEXT,         -- e.g., 'dev-01'
  p_matrix_type    TEXT,         -- e.g., 'benchmark' | 'id_pct' | ...
  p_ts_ms          BIGINT,       -- single timestamp for the slice
  p_expected_coins JSONB DEFAULT NULL,  -- optional override: ["BTC","ETH",...]
  p_idem           TEXT   DEFAULT NULL   -- optional idempotency key
) RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
  v_coins JSONB;
  v_n     INT;
  v_expected INT;
  v_cells INT;
  v_missing JSONB := '[]'::jsonb;
  v_payload JSONB;
BEGIN
  -- 3.1 figure out expected coin set
  IF p_expected_coins IS NOT NULL AND jsonb_typeof(p_expected_coins)='array' THEN
    v_coins := p_expected_coins;
  ELSE
    SELECT payload->'coins'
    INTO v_coins
    FROM public.app_session_settings
    WHERE app_session_id = p_app_session_id;
    IF v_coins IS NULL OR jsonb_typeof(v_coins) <> 'array' THEN
      RAISE EXCEPTION 'No coins array in app_session_settings for %', p_app_session_id;
    END IF;
  END IF;

  -- 3.2 compute expected off-diagonal size: N*(N-1)
  SELECT jsonb_array_length(v_coins) INTO v_n;
  v_expected := v_n * GREATEST(v_n - 1, 0);

  -- 3.3 count staged cells for this slice
  SELECT COUNT(*) INTO v_cells
  FROM public.dyn_matrix_values_stage
  WHERE ts_ms = p_ts_ms AND matrix_type = p_matrix_type;

  -- 3.4 build missing list (optional but handy)
  WITH coins AS (
    SELECT jsonb_array_elements_text(v_coins) AS sym
  ),
  grid AS (
    SELECT a.sym AS base, b.sym AS quote
    FROM coins a CROSS JOIN coins b
    WHERE a.sym <> b.sym
  ),
  staged AS (
    SELECT base, quote
    FROM public.dyn_matrix_values_stage
    WHERE ts_ms = p_ts_ms AND matrix_type = p_matrix_type
  )
  SELECT COALESCE(
           jsonb_agg(jsonb_build_object('base',g.base,'quote',g.quote)) FILTER (WHERE s.base IS NULL),
           '[]'::jsonb
         )
  INTO v_missing
  FROM grid g
  LEFT JOIN staged s ON s.base=g.base AND s.quote=g.quote;

  -- 3.5 publish to main table (UPSERT)
  INSERT INTO public.dyn_matrix_values(ts_ms, matrix_type, base, quote, value, meta)
  SELECT ts_ms, matrix_type, base, quote, value, meta
  FROM public.dyn_matrix_values_stage
  WHERE ts_ms = p_ts_ms AND matrix_type = p_matrix_type
  ON CONFLICT (ts_ms, matrix_type, base, quote)
  DO UPDATE SET value = EXCLUDED.value, meta = EXCLUDED.meta;

  -- 3.6 write cycle_document for audit
  v_payload := jsonb_build_object(
     'matrix_type', p_matrix_type,
     'ts_ms', p_ts_ms,
     'expected_cells', v_expected,
     'staged_cells', v_cells,
     'missing', v_missing
  );

  PERFORM public.upsert_cycle_document(
    'matrices', p_app_session_id, p_ts_ms, v_payload,
    NULL, v_cells,
    CASE WHEN v_cells <> v_expected THEN 'incomplete_grid' ELSE 'ok' END
  );

  -- 3.7 write one ledger line
  IF p_idem IS NOT NULL THEN
    INSERT INTO public.app_ledger(topic, event, payload, session_id, idempotency_key, ts_epoch_ms)
    VALUES ('matrices','commit_grid',
            jsonb_build_object('matrix_type',p_matrix_type,'ts_ms',p_ts_ms,'cells',v_cells,'expected',v_expected),
            p_app_session_id, p_idem, p_ts_ms)
    ON CONFLICT (idempotency_key) DO NOTHING;
  ELSE
    INSERT INTO public.app_ledger(topic, event, payload, session_id, ts_epoch_ms)
    VALUES ('matrices','commit_grid',
            jsonb_build_object('matrix_type',p_matrix_type,'ts_ms',p_ts_ms,'cells',v_cells,'expected',v_expected),
            p_app_session_id, p_ts_ms);
  END IF;

  -- 3.8 return a small report
  RETURN jsonb_build_object(
    'ok', TRUE,
    'matrix_type', p_matrix_type,
    'ts_ms', p_ts_ms,
    'expected_cells', v_expected,
    'staged_cells', v_cells,
    'missing_count', jsonb_array_length(v_missing),
    'complete', (v_cells = v_expected)
  );
END;
$$;

-- 4) Convenience cleaner: purge staged rows for a slice (if you need to redo)
CREATE OR REPLACE FUNCTION public.clear_matrix_stage(
  p_matrix_type TEXT,
  p_ts_ms BIGINT
) RETURNS VOID
LANGUAGE sql AS $$
  DELETE FROM public.dyn_matrix_values_stage
  WHERE matrix_type = p_matrix_type AND ts_ms = p_ts_ms;
$$;

COMMIT;


 --  APPEND -- 9) CIN-AUX LEDGER


 -- Sessions (use yours if already present)
create table if not exists strategy_aux.cin_session (
  session_id     bigserial primary key,
  window_label   text not null,
  started_at     timestamptz not null default now(),
  ended_at       timestamptz,
  closed         boolean not null default false
);

-- Bucket state per asset inside a session
create table if not exists strategy_aux.cin_balance (
  session_id        bigint not null references strategy_aux.cin_session(session_id) on delete cascade,
  asset_id          text   not null,
  opening_principal numeric not null default 0,
  opening_profit    numeric not null default 0,
  principal_usdt    numeric not null default 0,
  profit_usdt       numeric not null default 0,
  closing_principal numeric,
  closing_profit    numeric,
  primary key (session_id, asset_id)
);

-- MEA·mood referential targets (desired USDT allocation per asset)
create table if not exists strategy_aux.cin_reference (
  session_id   bigint not null references strategy_aux.cin_session(session_id) on delete cascade,
  asset_id     text   not null,
  ref_usdt     numeric not null,
  source_tag   text,
  computed_at  timestamptz not null default now(),
  primary key (session_id, asset_id)
);

-- Acquisition lots: created whenever an asset is destination of a hop
create table if not exists strategy_aux.cin_lot (
  lot_id          bigserial primary key,
  session_id      bigint not null references strategy_aux.cin_session(session_id) on delete cascade,
  asset_id        text   not null,
  origin_move_id  bigint,          -- move that created this lot
  p_in_usdt       numeric not null, -- entry price (USDT per unit)
  units_total     numeric not null, -- total units acquired into the lot
  units_free      numeric not null, -- remaining units available to consume
  created_at      timestamptz not null default now(),
  constraint cin_lot_nonneg check (units_free >= 0)
);

-- Move ledger (each hop)
create table if not exists strategy_aux.cin_move (
  move_id              bigserial primary key,
  session_id           bigint not null references strategy_aux.cin_session(session_id) on delete cascade,
  ts                   timestamptz not null default now(),
  from_asset           text not null,
  to_asset             text not null,
  executed_usdt        numeric not null,     -- USDT value moved (pre-fee or net—pick one and be consistent)
  fee_usdt             numeric not null default 0,
  slippage_usdt        numeric not null default 0,

  -- planning
  ref_usdt_target      numeric,
  planned_usdt         numeric,
  dev_ref_usdt         numeric,              -- executed - min(ref, available)

  -- composition snapshot from source buckets
  comp_principal_usdt  numeric not null,
  comp_profit_usdt     numeric not null,

  -- lot consumption (can be multiple lots; see link table below)
  p_bridge_in_usdt     numeric,              -- p_in of the effective consumed portion (weighted avg over lots)
  p_bridge_out_usdt    numeric,              -- price at exit time for bridge asset
  lot_units_used       numeric,              -- total units of bridge asset consumed across lots
  trace_usdt           numeric not null default 0,  -- X - X_basis
  profit_consumed_usdt numeric not null default 0,
  principal_hit_usdt   numeric not null default 0,

  -- destination fill
  to_units_received    numeric,

  residual_from_after  numeric,              -- bulk left in source after move (audit)
  notes                text
);

-- Link multiple lots to a single move (when consumption spans lots)
create table if not exists strategy_aux.cin_move_lotlink (
  move_id     bigint not null references strategy_aux.cin_move(move_id) on delete cascade,
  lot_id      bigint not null references strategy_aux.cin_lot(lot_id) on delete restrict,
  units_used  numeric not null,
  p_in_usdt   numeric not null,
  primary key (move_id, lot_id)
);

-- Price marks, if you MTM intra-session and at close
create table if not exists strategy_aux.cin_mark (
  session_id  bigint not null references strategy_aux.cin_session(session_id) on delete cascade,
  asset_id    text   not null,
  ts          timestamptz not null,
  price_usdt  numeric,        -- optional if you store price separately
  bulk_usdt   numeric not null,
  primary key (session_id, asset_id, ts)
);

-- Imprint / Luggage rollup at close
create table if not exists strategy_aux.cin_imprint_luggage (
  session_id      bigint primary key references strategy_aux.cin_session(session_id) on delete cascade,
  imprint_principal_churn_usdt numeric not null,
  imprint_profit_churn_usdt    numeric not null,
  imprint_generated_profit_usdt numeric not null,
  imprint_trace_sum_usdt       numeric not null,  -- Σ trace over all hops
  imprint_devref_sum_usdt      numeric not null,  -- Σ dev_ref over all hops
  luggage_total_principal_usdt numeric not null,
  luggage_total_profit_usdt    numeric not null
);

-- Handy indexes
create index if not exists idx_cin_move_session_ts on strategy_aux.cin_move(session_id, ts);
create index if not exists idx_cin_lot_session_asset on strategy_aux.cin_lot(session_id, asset_id);
create index if not exists idx_cin_mark_session_asset_ts on strategy_aux.cin_mark(session_id, asset_id, ts);

-- Schema: strategy_aux (align with your existing naming)
create schema if not exists strategy_aux;


-- Wallet registry (one per API coordinate)
create table if not exists strategy_aux.cin_wallet (
wallet_id bigserial primary key,
provider text not null default 'binance',
label text not null,
api_key_hash text not null,
created_at timestamptz not null default now()
);


-- Balance snapshots from provider (denormalized for speed, normalize later if desired)
create table if not exists strategy_aux.cin_balance_snapshot (
snapshot_id bigserial primary key,
wallet_id bigint not null references strategy_aux.cin_wallet(wallet_id),
taken_at timestamptz not null default now(),
asset text not null,
free_units numeric(38,18) not null,
locked_units numeric(38,18) not null
);
create index if not exists idx_cin_balance_wallet_time on strategy_aux.cin_balance_snapshot(wallet_id, taken_at desc);


-- Optional: execution trace (placeholder; adjust to your move/lot logic)
create table if not exists strategy_aux.cin_tx (
tx_id bigserial primary key,
wallet_id bigint not null references strategy_aux.cin_wallet(wallet_id),
provider_tx_id text,
symbol text,
side text, -- BUY/SELL
qty numeric(38,18),
price numeric(38,18),
quote_qty numeric(38,18),
executed_at timestamptz not null default now()
);


-- Helper upsert for wallet by label+api_key_hash (no secrets in DB)
create or replace function strategy_aux.cin_upsert_wallet(p_label text, p_api_key_hash text)
returns bigint language plpgsql as $$
declare v_id bigint; begin
select wallet_id into v_id from strategy_aux.cin_wallet where label = p_label and api_key_hash = p_api_key_hash;
if v_id is null then
insert into strategy_aux.cin_wallet(label, api_key_hash) values (p_label, p_api_key_hash) returning wallet_id into v_id;
end if;
return v_id;
end $$;