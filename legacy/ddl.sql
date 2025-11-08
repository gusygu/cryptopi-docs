-- cryptopi-dynamics • unified schema (PostgreSQL ≥ 13)
-- Idempotent: safe to run multiple times.
-- Single-file: includes prelude (extension+schema), core objects, functions, and cycle_documents.

-- ensure objects are created as cp_owner and in the right schemas
RESET ROLE;
SET ROLE cp_owner;
SET search_path TO public, strategy_aux;

-- IMPORTANT: comment out any extension creation in this file.
-- CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA public;  -- ← keep disabled here


-- extension must already exist (created once by superuser)
-- CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA public;  -- (leave commented here)

----------------------------------------------------------------
-- PRELUDE: extension, schema, search_path
--------------------------------------------------------------------------------

-- gen_random_uuid() etc.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Create the app schema if templated ${SCHEMA} is provided by runner (default: public)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = '${SCHEMA}') THEN
    EXECUTE format('CREATE SCHEMA IF NOT EXISTS %I', '${SCHEMA}');
  END IF;
END$$;

-- Prefer ${SCHEMA}, then public for unqualified names
SET search_path TO "${SCHEMA}", public;

--------------------------------------------------------------------------------
-- CORE REFS
--------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS app_sessions (
  app_session_id text PRIMARY KEY,
  started_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS coins ( symbol text PRIMARY KEY );

CREATE TABLE IF NOT EXISTS pairs (
  base  text NOT NULL REFERENCES coins(symbol),
  quote text NOT NULL REFERENCES coins(symbol),
  PRIMARY KEY (base, quote)
);

-- Optional cycle clock (e.g., 40s cadence)
CREATE TABLE IF NOT EXISTS cycles (
  cycle_ts   bigint PRIMARY KEY,   -- epoch ms
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Legacy compatibility: domain "snapshots" over jsonb
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'snapshots') THEN
    CREATE DOMAIN snapshots AS jsonb;
  END IF;
END
$$;

--------------------------------------------------------------------------------
-- DYNAMICS MATRICES (history)
--------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS dyn_matrix_values (
  ts_ms        BIGINT           NOT NULL,
  matrix_type  TEXT             NOT NULL CHECK (matrix_type IN ('benchmark','delta','pct24h','id_pct','pct_drv')),
  base         TEXT             NOT NULL,
  quote        TEXT             NOT NULL,
  value        DOUBLE PRECISION NOT NULL,
  meta         JSONB            NOT NULL DEFAULT '{}'::jsonb,
  PRIMARY KEY (ts_ms, matrix_type, base, quote)
);

CREATE INDEX IF NOT EXISTS dyn_mv_idx_pair
  ON dyn_matrix_values (matrix_type, base, quote, ts_ms DESC);

-- Optional “latest-by-type” helper index
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'dyn_matrix_values') THEN
    CREATE INDEX IF NOT EXISTS idx_dyn_matrix_values_latest
      ON dyn_matrix_values (matrix_type, ts_ms DESC, base, quote);
  END IF;
END $$;

--------------------------------------------------------------------------------
-- INGEST NORMALIZATION (AUX INPUTS)
--------------------------------------------------------------------------------
-- (a) USDT prices per symbol per cycle
CREATE TABLE IF NOT EXISTS prices_usdt (
  cycle_ts   bigint NOT NULL REFERENCES cycles(cycle_ts),
  symbol     text   NOT NULL REFERENCES coins(symbol),
  price_usdt double precision NOT NULL,
  PRIMARY KEY (cycle_ts, symbol)
);

-- (b) MEA orientations (pair-based) per cycle
CREATE TABLE IF NOT EXISTS mea_orientations (
  cycle_ts bigint NOT NULL REFERENCES cycles(cycle_ts),
  base     text   NOT NULL REFERENCES coins(symbol),
  quote    text   NOT NULL REFERENCES coins(symbol),
  metric   text   NOT NULL DEFAULT 'id_pct',
  value    double precision NOT NULL, -- decimal (0.00002 == 0.002%)
  PRIMARY KEY (cycle_ts, base, quote, metric)
);

-- (c) Symbol-level unified reference (compat view)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname = 'mea_unified_refs' AND c.relkind = 'r'
  ) THEN
    EXECUTE 'DROP TABLE IF EXISTS mea_unified_refs CASCADE';
  END IF;
END $$;

CREATE OR REPLACE VIEW mea_unified_refs AS
SELECT
  o.cycle_ts,
  o.base AS symbol,
  AVG(o.value) AS id_pct
FROM mea_orientations o
WHERE o.metric = 'id_pct'
GROUP BY 1,2;

--------------------------------------------------------------------------------
-- STRATEGY AUX (STR-AUX): sessions + events
--------------------------------------------------------------------------------
CREATE SCHEMA IF NOT EXISTS strategy_aux;

-- Canonical session row for (base, quote, window, app_session_id)
CREATE TABLE IF NOT EXISTS strategy_aux.str_aux_session (
  id                   BIGSERIAL PRIMARY KEY,

  pair_base            TEXT NOT NULL,
  pair_quote           TEXT NOT NULL DEFAULT 'USDT',
  window_key           TEXT NOT NULL,                 -- '30m' | '1h' | '3h'
  app_session_id       TEXT NOT NULL,

  -- opening anchor for the app session
  opening_stamp        BOOLEAN NOT NULL DEFAULT FALSE,
  opening_ts           BIGINT  NOT NULL,
  opening_price        DOUBLE PRECISION NOT NULL,

  -- running mins/maxs for the session
  price_min            DOUBLE PRECISION NOT NULL,
  price_max            DOUBLE PRECISION NOT NULL,
  bench_pct_min        DOUBLE PRECISION NOT NULL,
  bench_pct_max        DOUBLE PRECISION NOT NULL,

  -- counters
  swaps                INTEGER NOT NULL DEFAULT 0,
  shifts               INTEGER NOT NULL DEFAULT 0,

  -- GFM helpers
  gfm_anchor_price     DOUBLE PRECISION,
  gfm_calc_price_last  NUMERIC,
  gfm_r_last           DOUBLE PRECISION,

  ui_epoch             INTEGER NOT NULL DEFAULT 0,
  above_count          INTEGER NOT NULL DEFAULT 0,
  below_count          INTEGER NOT NULL DEFAULT 0,

  -- thresholds
  eta_pct              DOUBLE PRECISION NOT NULL,     -- swap epsilon (%)
  eps_shift_pct        DOUBLE PRECISION NOT NULL,     -- shift epsilon (%)
  k_cycles             INTEGER NOT NULL,              -- e.g., 32

  -- last seen
  last_price           DOUBLE PRECISION,
  last_update_ms       BIGINT NOT NULL,

  -- prev/cur UI snapshots
  snap_prev            JSONB,
  snap_cur             JSONB,

  -- greatest absolutes this session
  greatest_bench_abs   DOUBLE PRECISION NOT NULL DEFAULT 0,
  greatest_drv_abs     DOUBLE PRECISION NOT NULL DEFAULT 0,
  greatest_pct24h_abs  DOUBLE PRECISION NOT NULL DEFAULT 0,

  -- shift stamp & last gfm delta
  shift_stamp          BOOLEAN NOT NULL DEFAULT FALSE,
  gfm_delta_last       DOUBLE PRECISION,

  CONSTRAINT uq_str_aux_session UNIQUE (pair_base, pair_quote, window_key, app_session_id)
);

CREATE INDEX IF NOT EXISTS idx_str_aux_session_lookup
  ON strategy_aux.str_aux_session (pair_base, pair_quote, window_key, app_session_id);

-- Events in STR-AUX (opening | swap | shift)
CREATE TABLE IF NOT EXISTS strategy_aux.str_aux_event (
  id           BIGSERIAL PRIMARY KEY,
  session_id   BIGINT NOT NULL REFERENCES strategy_aux.str_aux_session(id) ON DELETE CASCADE,
  kind         TEXT NOT NULL,                      -- 'opening' | 'swap' | 'shift'
  payload      JSONB,
  created_ms   BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_str_aux_event_session
  ON strategy_aux.str_aux_event (session_id, created_ms DESC);

-- Compat view: session_openings (session_ts, opening_price)
CREATE OR REPLACE VIEW session_openings AS
WITH ranked AS (
  SELECT
    opening_ts AS session_ts,
    opening_price,
    ROW_NUMBER() OVER (PARTITION BY opening_ts ORDER BY id DESC) AS rn
  FROM strategy_aux.str_aux_session
  WHERE opening_stamp = TRUE
)
SELECT session_ts, opening_price
FROM ranked
WHERE rn = 1;

--------------------------------------------------------------------------------
-- TRANSFER LEDGER (execution-aware journal)
--------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS transfer_ledger (
  app_session_id   text   NOT NULL REFERENCES app_sessions(app_session_id),
  cycle_ts         bigint NOT NULL REFERENCES cycles(cycle_ts),
  leg_seq          integer NOT NULL,
  route_id         text,
  intent_id        text,
  from_symbol      text NOT NULL REFERENCES coins(symbol),
  to_symbol        text NOT NULL REFERENCES coins(symbol),
  qty_from         double precision NOT NULL,
  qty_to           double precision NOT NULL,
  price_from_usdt  double precision NOT NULL,
  price_to_usdt    double precision NOT NULL,
  fee_usdt         double precision NOT NULL DEFAULT 0,
  exec_ts          bigint NOT NULL,
  tx_id            text,
  PRIMARY KEY (app_session_id, cycle_ts, leg_seq)
);

CREATE INDEX IF NOT EXISTS idx_ledger_session_ts
  ON transfer_ledger (app_session_id, cycle_ts);

CREATE INDEX IF NOT EXISTS idx_ledger_symbols
  ON transfer_ledger (from_symbol, to_symbol);

-- Rollup view (flows & realized P/L)
CREATE OR REPLACE VIEW v_transfer_ledger_rollup AS
WITH legs AS (
  SELECT
    app_session_id,
    cycle_ts,
    from_symbol,
    to_symbol,
    (qty_to   * price_to_usdt)   AS inflow_to_usdt,
    (qty_from * price_from_usdt) AS outflow_from_usdt,
    ((qty_to * price_to_usdt) - (qty_from * price_from_usdt) - fee_usdt) AS profit_leg_usdt,
    fee_usdt
  FROM transfer_ledger
),
sym_flow AS (
  SELECT app_session_id, cycle_ts, symbol,
         SUM(inflow_usdt)  AS inflow_usdt,
         SUM(outflow_usdt) AS outflow_usdt,
         SUM(fees_usdt)    AS fees_usdt
  FROM (
    SELECT app_session_id, cycle_ts, to_symbol   AS symbol, inflow_to_usdt   AS inflow_usdt, 0                  AS outflow_usdt, fee_usdt AS fees_usdt FROM legs
    UNION ALL
    SELECT app_session_id, cycle_ts, from_symbol AS symbol, 0                AS inflow_usdt, outflow_from_usdt  AS outflow_usdt, 0        AS fees_usdt FROM legs
  ) x
  GROUP BY app_session_id, cycle_ts, symbol
),
sym_profit AS (
  SELECT app_session_id, cycle_ts, to_symbol AS symbol, SUM(profit_leg_usdt) AS realized_profit_usdt
  FROM legs
  GROUP BY app_session_id, cycle_ts, to_symbol
)
SELECT
  f.app_session_id,
  f.cycle_ts,
  f.symbol,
  COALESCE(f.inflow_usdt, 0)          AS inflow_usdt,
  COALESCE(f.outflow_usdt, 0)         AS outflow_usdt,
  COALESCE(p.realized_profit_usdt, 0) AS realized_profit_usdt,
  COALESCE(f.fees_usdt, 0)            AS fees_usdt
FROM sym_flow f
LEFT JOIN sym_profit p
  ON p.app_session_id = f.app_session_id
 AND p.cycle_ts      = f.cycle_ts
 AND p.symbol        = f.symbol;

--------------------------------------------------------------------------------
-- CIN (cycle + session accumulators + view)
--------------------------------------------------------------------------------
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
  c.app_session_id,
  c.cycle_ts,
  c.symbol,
  c.wallet_usdt,
  c.profit_usdt,
  c.imprint_cycle_usdt,
  c.luggage_cycle_usdt,
  COALESCE(a.imprint_acc_usdt, 0) AS imprint_app_session_usdt,
  COALESCE(a.luggage_acc_usdt, 0) AS luggage_app_session_usdt
FROM cin_aux_cycle c
LEFT JOIN cin_aux_session_acc a
  ON a.app_session_id = c.app_session_id
 AND a.symbol        = c.symbol;

--------------------------------------------------------------------------------
-- AUX (MEA) grid snapshots for audit/replay
--------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS aux_mea_snapshots (
  ts_ms      bigint       NOT NULL,
  coins      text[]       NOT NULL,
  k          int          NOT NULL,
  grid       jsonb        NOT NULL,
  warnings   text[]       NOT NULL DEFAULT '{}',
  created_at timestamptz  NOT NULL DEFAULT now()
);

--------------------------------------------------------------------------------
-- APPLICATION LEDGER (low-friction app/system events)
--------------------------------------------------------------------------------
-- Keep transfer_ledger for routes; use app_ledger for light app/system events.
CREATE TABLE IF NOT EXISTS public.app_ledger (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  topic            text NOT NULL,            -- e.g. 'calc','api','pipeline'
  event            text NOT NULL,            -- e.g. 'dyn_matrix_upsert'
  payload          jsonb,
  session_id       text,
  idempotency_key  text UNIQUE,              -- optional for dedupe
  ts_epoch_ms      bigint NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now()
);

--------------------------------------------------------------------------------
-- FUNCTIONS (upserts + reference wrappers)
--------------------------------------------------------------------------------
-- Upsert into dyn_matrix_values + app_ledger
CREATE OR REPLACE FUNCTION upsert_dyn_matrix_value(
  p_ts_ms BIGINT, p_type TEXT, p_base TEXT, p_quote TEXT,
  p_value DOUBLE PRECISION, p_meta JSONB, p_session_id TEXT, p_idem TEXT
) RETURNS VOID AS $$
BEGIN
  INSERT INTO dyn_matrix_values(ts_ms, matrix_type, base, quote, value, meta)
  VALUES (p_ts_ms, p_type, p_base, p_quote, p_value, COALESCE(p_meta,'{}'::jsonb))
  ON CONFLICT (ts_ms, matrix_type, base, quote)
  DO UPDATE SET value = EXCLUDED.value, meta = EXCLUDED.meta;

  INSERT INTO app_ledger(topic, event, payload, session_id, idempotency_key, ts_epoch_ms)
  VALUES ('calc','dyn_matrix_upsert',
          jsonb_build_object('ts_ms',p_ts_ms,'type',p_type,'base',p_base,'quote',p_quote,'value',p_value),
          p_session_id, p_idem, EXTRACT(EPOCH FROM now())::bigint*1000)
  ON CONFLICT (idempotency_key) DO NOTHING;
END;
$$ LANGUAGE plpgsql;

-- Upsert STR-AUX session row opening anchor + app_ledger
CREATE OR REPLACE FUNCTION upsert_str_aux_opening(
  p_base TEXT, p_quote TEXT, p_window TEXT, p_app_session_id TEXT,
  p_opening_ts BIGINT, p_opening_price DOUBLE PRECISION,
  p_eta_pct DOUBLE PRECISION, p_eps_shift_pct DOUBLE PRECISION, p_k_cycles INT,
  p_idem TEXT
) RETURNS BIGINT AS $$
DECLARE v_id BIGINT;
BEGIN
  INSERT INTO strategy_aux.str_aux_session(
    pair_base, pair_quote, window_key, app_session_id,
    opening_stamp, opening_ts, opening_price,
    price_min, price_max, bench_pct_min, bench_pct_max,
    eta_pct, eps_shift_pct, k_cycles, last_update_ms
  ) VALUES (
    p_base, COALESCE(p_quote,'USDT'), p_window, p_app_session_id,
    TRUE, p_opening_ts, p_opening_price,
    p_opening_price, p_opening_price, 0, 0,
    p_eta_pct, p_eps_shift_pct, p_k_cycles, p_opening_ts
  )
  ON CONFLICT (pair_base, pair_quote, window_key, app_session_id)
  DO UPDATE SET
    opening_stamp   = TRUE,
    opening_ts      = EXCLUDED.opening_ts,
    opening_price   = EXCLUDED.opening_price,
    price_min       = LEAST(strategy_aux.str_aux_session.price_min, EXCLUDED.opening_price),
    price_max       = GREATEST(strategy_aux.str_aux_session.price_max, EXCLUDED.opening_price),
    last_update_ms  = EXCLUDED.opening_ts
  RETURNING id INTO v_id;

  INSERT INTO app_ledger(topic, event, payload, session_id, idempotency_key, ts_epoch_ms)
  VALUES ('str-aux','opening_set',
          jsonb_build_object('session_id',v_id,'base',p_base,'quote',p_quote,'window',p_window,
                             'opening_ts',p_opening_ts,'opening_price',p_opening_price),
          p_app_session_id, p_idem, p_opening_ts)
  ON CONFLICT (idempotency_key) DO NOTHING;

  RETURN v_id;
END;
$$ LANGUAGE plpgsql;

-- Reference API wrappers (map to existing freezeshot_* if present)
DO $$
BEGIN
  -- create_reference
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
     WHERE n.nspname='public' AND p.proname='create_reference'
  ) THEN
    CREATE OR REPLACE FUNCTION create_reference(
      p_ref text,
      p_target_ts bigint,
      p_app_session_id text,
      p_is_reference boolean DEFAULT true
    ) RETURNS TABLE (id text, overall_no bigint, session_no int)
    LANGUAGE plpgsql AS $f$
    BEGIN
      RETURN QUERY SELECT * FROM create_freezeshot(p_ref, p_target_ts, p_app_session_id, p_is_reference);
    END;
    $f$;
  END IF;

  -- reference_nearest
  IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
                  WHERE n.nspname='public' AND p.proname='reference_nearest') THEN
    CREATE OR REPLACE FUNCTION reference_nearest(
      p_ts bigint, p_ref text DEFAULT NULL, p_app_session_id text DEFAULT NULL
    ) RETURNS snapshots
    LANGUAGE plpgsql STABLE AS $f$
    BEGIN
      RETURN freezeshot_nearest(p_ts, p_ref, p_app_session_id);
    END;
    $f$;
  END IF;

  -- reference_prev
  IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
                  WHERE n.nspname='public' AND p.proname='reference_prev') THEN
    CREATE OR REPLACE FUNCTION reference_prev(
      p_target_ts bigint, p_ref text DEFAULT NULL, p_app_session_id text DEFAULT NULL
    ) RETURNS snapshots
    LANGUAGE plpgsql STABLE AS $f$
    BEGIN
      RETURN freezeshot_prev(p_target_ts, p_ref, p_app_session_id);
    END;
    $f$;
  END IF;

  -- reference_next
  IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
                  WHERE n.nspname='public' AND p.proname='reference_next') THEN
    CREATE OR REPLACE FUNCTION reference_next(
      p_target_ts bigint, p_ref text DEFAULT NULL, p_app_session_id text DEFAULT NULL
    ) RETURNS snapshots
    LANGUAGE plpgsql STABLE AS $f$
    BEGIN
      RETURN freezeshot_next(p_target_ts, p_ref, p_app_session_id);
    END;
    $f$;
  END IF;

  -- reference_list
  IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
                  WHERE n.nspname='public' AND p.proname='reference_list') THEN
    CREATE OR REPLACE FUNCTION reference_list(
      p_ref text DEFAULT NULL,
      p_app_session_id text DEFAULT NULL,
      p_before_ts bigint DEFAULT NULL,
      p_after_ts  bigint DEFAULT NULL,
      p_limit int DEFAULT 50
    ) RETURNS SETOF snapshots
    LANGUAGE plpgsql STABLE AS $f$
    BEGIN
      RETURN QUERY SELECT * FROM freezeshot_list(p_ref, p_app_session_id, p_before_ts, p_after_ts, p_limit);
    END;
    $f$;
  END IF;

  -- reference_mark_uploaded
  IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
                  WHERE n.nspname='public' AND p.proname='reference_mark_uploaded') THEN
    CREATE OR REPLACE FUNCTION reference_mark_uploaded(p_id text, p_uploaded boolean DEFAULT true)
    RETURNS VOID
    LANGUAGE plpgsql AS $f$
    BEGIN
      PERFORM freezeshot_mark_uploaded(p_id, p_uploaded);
    END;
    $f$;
  END IF;
END $$;

--------------------------------------------------------------------------------
-- MEA-AUX snapshots (per-session, per-pair, per-window)
--------------------------------------------------------------------------------
-- Keeps per-cycle payloads for MEA; summary view used by smokes and UI
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
SELECT
  s.base,
  s.quote,
  s.window_key,
  COUNT(*)        AS samples,
  MAX(s.cycle_ts) AS last_cycle_ts
FROM mea_aux_snapshots s
GROUP BY 1,2,3;

--------------------------------------------------------------------------------
-- STRATEGY_AUX snapshots (staging for STR session refresher)
--------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.strategy_aux_snapshots (
  id bigserial primary key,
  app_session_id text not null,
  pair text not null,
  win  text not null,
  payload jsonb not null,
  created_at timestamptz not null default now()
);

CREATE INDEX IF NOT EXISTS idx_straux_app_pair_win_time
  ON public.strategy_aux_snapshots (app_session_id, pair, win, created_at desc);

CREATE INDEX IF NOT EXISTS idx_straux_payload_gin
  ON public.strategy_aux_snapshots using gin (payload);

--------------------------------------------------------------------------------
-- CYCLE DOCUMENTS (per-cycle JSON audit for matrices, mea, cin, str)
--------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.cycle_documents (
  domain           text        NOT NULL CHECK (domain IN ('matrices','mea','cin','str')),
  app_session_id   text        NOT NULL,
  cycle_ts         bigint      NOT NULL,         -- epoch ms
  payload          jsonb       NOT NULL,         -- full cycle “document” for the domain
  created_at       timestamptz NOT NULL DEFAULT now(),
  pairs_count      int,
  rows_count       int,
  notes            text,
  CONSTRAINT cycle_documents_pkey PRIMARY KEY (domain, app_session_id, cycle_ts)
);

CREATE INDEX IF NOT EXISTS idx_cycle_documents_latest
  ON public.cycle_documents (domain, app_session_id, cycle_ts DESC);

CREATE INDEX IF NOT EXISTS idx_cycle_documents_created
  ON public.cycle_documents (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_cycle_documents_payload_gin
  ON public.cycle_documents USING gin (payload);

COMMENT ON TABLE public.cycle_documents IS
  'Per-cycle JSON audit documents for matrices, mea, cin, str (one row per domain/app_session_id/cycle_ts).';

-- Upsert helper
CREATE OR REPLACE FUNCTION public.upsert_cycle_document(
  p_domain         text,
  p_app_session_id text,
  p_cycle_ts       bigint,
  p_payload        jsonb,
  p_pairs_count    int DEFAULT NULL,
  p_rows_count     int DEFAULT NULL,
  p_notes          text DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  INSERT INTO public.cycle_documents (domain, app_session_id, cycle_ts, payload, pairs_count, rows_count, notes)
  VALUES (p_domain, p_app_session_id, p_cycle_ts, p_payload, p_pairs_count, p_rows_count, p_notes)
  ON CONFLICT (domain, app_session_id, cycle_ts) DO UPDATE
  SET payload     = EXCLUDED.payload,
      pairs_count = EXCLUDED.pairs_count,
      rows_count  = EXCLUDED.rows_count,
      notes       = EXCLUDED.notes,
      created_at  = now();
END;
$$;

-- Latest doc per domain/app_session
CREATE OR REPLACE VIEW public.v_cycle_documents_latest AS
SELECT DISTINCT ON (domain, app_session_id)
       domain, app_session_id, cycle_ts, payload, created_at, pairs_count, rows_count, notes
FROM public.cycle_documents
ORDER BY domain, app_session_id, cycle_ts DESC;

--------------------------------------------------------------------------------
-- ROLES & GRANTS (idempotent)
--------------------------------------------------------------------------------

-- 1) Create group roles if missing (NOLOGIN = groups; attach real logins later)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'cp_owner') THEN
    CREATE ROLE cp_owner NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'cp_writer') THEN
    CREATE ROLE cp_writer NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'cp_app') THEN
    CREATE ROLE cp_app NOLOGIN;
  END IF;
END$$;

-- (Optional) attach your existing login roles:
-- GRANT cp_owner  TO your_login_owner;
-- GRANT cp_writer TO your_login_writer;
-- GRANT cp_app    TO your_login_app;

-- 2) Ensure schemas exist and are usable by app/writer
CREATE SCHEMA IF NOT EXISTS strategy_aux;
GRANT USAGE ON SCHEMA public       TO cp_app, cp_writer;
GRANT USAGE ON SCHEMA strategy_aux TO cp_app, cp_writer;

-- 3) Existing objects: broad read for app, write perms where needed
-- Tables & views (current objects)
GRANT SELECT ON ALL TABLES    IN SCHEMA public, strategy_aux TO cp_app;
GRANT SELECT ON ALL TABLES    IN SCHEMA public, strategy_aux TO cp_writer;
-- Sequences (SERIAL/BIGSERIAL)
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public, strategy_aux TO cp_app, cp_writer;
-- Functions
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public, strategy_aux TO cp_app, cp_writer;

-- Specific writer targets (INSERT/UPDATE as appropriate)
GRANT INSERT, UPDATE ON public.dyn_matrix_values                 TO cp_writer;
GRANT INSERT          ON public.strategy_aux_snapshots           TO cp_writer;
GRANT INSERT, UPDATE ON strategy_aux.str_aux_session            TO cp_writer;
GRANT INSERT          ON strategy_aux.str_aux_event             TO cp_writer;
GRANT INSERT          ON public.cin_aux_cycle                    TO cp_writer;
GRANT INSERT, UPDATE ON public.cin_aux_session_acc              TO cp_writer;
GRANT INSERT          ON public.mea_orientations                 TO cp_writer;
GRANT INSERT, UPDATE ON public.cycle_documents                  TO cp_writer;

-- App is read-mostly, but allowed to log to app_ledger
GRANT INSERT ON public.app_ledger TO cp_app;
GRANT SELECT ON public.app_ledger TO cp_app, cp_writer;

-- 4) Default privileges for FUTURE objects created by cp_owner
-- (Make sure migrations run AS cp_owner for these to apply)
ALTER DEFAULT PRIVILEGES FOR ROLE cp_owner IN SCHEMA public
  GRANT SELECT ON TABLES    TO cp_app;
ALTER DEFAULT PRIVILEGES FOR ROLE cp_owner IN SCHEMA public
  GRANT SELECT ON TABLES    TO cp_writer;
ALTER DEFAULT PRIVILEGES FOR ROLE cp_owner IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO cp_app, cp_writer;
ALTER DEFAULT PRIVILEGES FOR ROLE cp_owner IN SCHEMA public
  GRANT EXECUTE ON FUNCTIONS TO cp_app, cp_writer;

ALTER DEFAULT PRIVILEGES FOR ROLE cp_owner IN SCHEMA strategy_aux
  GRANT SELECT ON TABLES    TO cp_app;
ALTER DEFAULT PRIVILEGES FOR ROLE cp_owner IN SCHEMA strategy_aux
  GRANT SELECT ON TABLES    TO cp_writer;
ALTER DEFAULT PRIVILEGES FOR ROLE cp_owner IN SCHEMA strategy_aux
  GRANT USAGE, SELECT ON SEQUENCES TO cp_app, cp_writer;
ALTER DEFAULT PRIVILEGES FOR ROLE cp_owner IN SCHEMA strategy_aux
  GRANT EXECUTE ON FUNCTIONS TO cp_app, cp_writer;

-- 5) (Optional) hand off ownership of objects to cp_owner (run as current owner/superuser)
-- This keeps all future ALTER DEFAULT PRIVILEGES effective.
DO $$
DECLARE r record;
BEGIN
  -- schemas
  BEGIN EXECUTE 'ALTER SCHEMA public OWNER TO cp_owner';       EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN EXECUTE 'ALTER SCHEMA strategy_aux OWNER TO cp_owner'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;

  -- tables & views in public
  FOR r IN
    SELECT format('%I.%I', n.nspname, c.relname) AS qname
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname IN ('public','strategy_aux') AND c.relkind IN ('r','v','m')
  LOOP
    BEGIN EXECUTE 'ALTER TABLE '||r.qname||' OWNER TO cp_owner'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  END LOOP;

  -- sequences
  FOR r IN
    SELECT format('%I.%I', n.nspname, c.relname) AS qname
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname IN ('public','strategy_aux') AND c.relkind = 'S'
  LOOP
    BEGIN EXECUTE 'ALTER SEQUENCE '||r.qname||' OWNER TO cp_owner'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  END LOOP;

  -- functions
  FOR r IN
    SELECT format('%I.%I(%s)', n.nspname, p.proname,
                  pg_get_function_identity_arguments(p.oid)) AS qname
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname IN ('public','strategy_aux')
  LOOP
    BEGIN EXECUTE 'ALTER FUNCTION '||r.qname||' OWNER TO cp_owner'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  END LOOP;
END$$;

-- 6) Safety: re-apply selects (in case ownership changed after grants)
GRANT SELECT ON ALL TABLES    IN SCHEMA public, strategy_aux TO cp_app, cp_writer;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public, strategy_aux TO cp_app, cp_writer;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public, strategy_aux TO cp_app, cp_writer;

-- src/db/ddl-docs.sql
-- Idempotent DDL for cycle documents used by smoke:diag:docs and job:docs:test-write

BEGIN;

-- Main table
CREATE TABLE IF NOT EXISTS cycle_documents (
  id             BIGSERIAL PRIMARY KEY,
  domain         TEXT        NOT NULL,            -- 'MATRICES' | 'MEA' | 'CIN' | 'STR' | ...
  app_session_id TEXT        NOT NULL,
  cycle_ts       BIGINT      NOT NULL,            -- epoch ms
  pairs          INTEGER,                         -- optional: number of pairs summarized
  rows           INTEGER,                         -- optional: number of rows summarized
  payload        JSONB       NOT NULL DEFAULT '{}'::jsonb,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (domain, app_session_id, cycle_ts)
);

-- If table already existed without an id, retrofit a sequence + default.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'cycle_documents' AND column_name = 'id'
  ) THEN
    ALTER TABLE cycle_documents ADD COLUMN id BIGINT;
    CREATE SEQUENCE IF NOT EXISTS cycle_documents_id_seq OWNED BY cycle_documents.id;
    ALTER TABLE cycle_documents ALTER COLUMN id SET DEFAULT nextval('cycle_documents_id_seq');
    -- Backfill existing rows
    UPDATE cycle_documents SET id = nextval('cycle_documents_id_seq') WHERE id IS NULL;
    ALTER TABLE cycle_documents ALTER COLUMN id SET NOT NULL;
    ALTER TABLE cycle_documents ADD PRIMARY KEY (id);
  END IF;
END $$;

COMMIT;

ALTER TABLE strategy_aux.str_aux_session ALTER COLUMN eta_pct DROP NOT NULL;
-- or
ALTER TABLE strategy_aux.str_aux_session DROP COLUMN eta_pct;

-- AUDIT EVENTS (lightweight)
create table if not exists public.audit_events (
  id bigserial primary key,
  at_ts timestamptz default now(),
  kind text not null,               -- e.g. 'matrices.write', 'api.matrices.latest'
  cycle_id text,                    -- correlation id for a full pass
  app_session_id text,
  ts_ms bigint,                     -- logical ts for the event
  rows_count int,
  pairs_count int,
  note text,
  extra jsonb
);

create index if not exists audit_events_at_ts_desc on public.audit_events (at_ts desc);
create index if not exists audit_events_kind_at on public.audit_events (kind, at_ts desc);


CREATE OR REPLACE FUNCTION upsert_str_aux_opening(
  p_base TEXT, p_quote TEXT, p_window TEXT, p_app_session_id TEXT,
  p_opening_ts BIGINT, p_opening_price DOUBLE PRECISION,
  p_eta_pct DOUBLE PRECISION, p_eps_shift_pct DOUBLE PRECISION, p_k_cycles INT,
  p_idem TEXT
) RETURNS BIGINT AS $$
DECLARE v_id BIGINT;
BEGIN
  INSERT INTO strategy_aux.str_aux_session(
    pair_base, pair_quote, window_key, app_session_id,
    opening_stamp, opening_ts, opening_price,
    price_min, price_max, bench_pct_min, bench_pct_max,
    eta_pct, eps_shift_pct, k_cycles, last_update_ms,
    -- hard resets on session opening
    shifts, swaps, ui_epoch, above_count, below_count, shift_stamp,
    gfm_anchor_price, gfm_calc_price_last, gfm_r_last, gfm_delta_last,
    last_price
  ) VALUES (
    p_base, COALESCE(p_quote,'USDT'), p_window, p_app_session_id,
    TRUE, p_opening_ts, p_opening_price,
    p_opening_price, p_opening_price, 0, 0,
    p_eta_pct, p_eps_shift_pct, p_k_cycles, p_opening_ts,
    0, 0, 0, 0, 0, FALSE,
    p_opening_price, NULL, NULL, NULL,
    p_opening_price
  )
  ON CONFLICT (pair_base, pair_quote, window_key, app_session_id)
  DO UPDATE SET
    opening_stamp   = TRUE,
    opening_ts      = EXCLUDED.opening_ts,
    opening_price   = EXCLUDED.opening_price,
    price_min       = EXCLUDED.opening_price,
    price_max       = EXCLUDED.opening_price,
    bench_pct_min   = 0, bench_pct_max = 0,
    eta_pct         = EXCLUDED.eta_pct,
    eps_shift_pct   = EXCLUDED.eps_shift_pct,
    k_cycles        = EXCLUDED.k_cycles,
    last_update_ms  = EXCLUDED.last_update_ms,
    -- resets on every new opening
    shifts          = 0, swaps = 0, ui_epoch = 0,
    above_count     = 0, below_count = 0, shift_stamp = FALSE,
    gfm_anchor_price = EXCLUDED.opening_price,
    gfm_calc_price_last = NULL,
    gfm_r_last = NULL,
    gfm_delta_last = NULL,
    last_price = EXCLUDED.opening_price
  RETURNING id INTO v_id;

  INSERT INTO app_ledger(topic, event, payload, session_id, idempotency_key, ts_epoch_ms)
  VALUES ('str-aux','opening_set',
          jsonb_build_object('session_id',v_id,'base',p_base,'quote',p_quote,'window',p_window,
                             'opening_ts',p_opening_ts,'opening_price',p_opening_price),
          p_app_session_id, p_idem, p_opening_ts)
  ON CONFLICT (idempotency_key) DO NOTHING;

  RETURN v_id;
END;
$$ LANGUAGE plpgsql;


CREATE TABLE IF NOT EXISTS public.app_session_settings (
  app_session_id   text PRIMARY KEY REFERENCES app_sessions(app_session_id) ON DELETE CASCADE,
  payload          jsonb        NOT NULL DEFAULT '{}'::jsonb, -- { coins:[], windows:[], poller:{...}, ... }
  updated_at       timestamptz  NOT NULL DEFAULT now()
);

-- helper upsert for the API
CREATE OR REPLACE FUNCTION public.upsert_app_session_settings(
  p_app_session_id text,
  p_payload jsonb
) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO public.app_session_settings(app_session_id, payload)
  VALUES (p_app_session_id, COALESCE(p_payload,'{}'::jsonb))
  ON CONFLICT (app_session_id) DO UPDATE
    SET payload = EXCLUDED.payload, updated_at = now();
END$$;


-- latest ts per matrix_type
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

-- optional: pair-indexed helper
CREATE OR REPLACE VIEW v_dyn_matrix_latest_by_pair AS
SELECT matrix_type, base, quote, value, meta
FROM v_dyn_matrix_latest;

-- 1) safety function: create app session if missing
CREATE OR REPLACE FUNCTION public.ensure_app_session(p_app_session_id text)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO app_sessions(app_session_id) VALUES (p_app_session_id)
  ON CONFLICT (app_session_id) DO NOTHING;
END$$;

-- 2) make settings upsert auto-create the session (no more FK breaks)
CREATE OR REPLACE FUNCTION public.upsert_app_session_settings(
  p_app_session_id text,
  p_payload jsonb
) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM public.ensure_app_session(p_app_session_id);

  INSERT INTO public.app_session_settings(app_session_id, payload)
  VALUES (p_app_session_id, COALESCE(p_payload,'{}'::jsonb))
  ON CONFLICT (app_session_id) DO UPDATE
    SET payload = EXCLUDED.payload, updated_at = now();
END$$;

-- repair: stamp opening + reset counters/anchors for all rows with an opening_ts
UPDATE strategy_aux.str_aux_session s
SET opening_stamp = TRUE,
    price_min     = opening_price,
    price_max     = opening_price,
    bench_pct_min = 0,
    bench_pct_max = 0,
    shifts        = 0,
    swaps         = 0,
    ui_epoch      = 0,
    above_count   = 0,
    below_count   = 0,
    shift_stamp   = FALSE,
    gfm_anchor_price     = opening_price,
    gfm_calc_price_last  = NULL,
    gfm_r_last           = NULL,
    gfm_delta_last       = NULL,
    last_price           = opening_price
WHERE opening_ts IS NOT NULL
  AND opening_stamp = FALSE;

-- optional: backfill a ledger event so we can trace
INSERT INTO app_ledger(topic, event, payload, session_id, idempotency_key, ts_epoch_ms)
SELECT 'str-aux','opening_set',
       jsonb_build_object('str_session_id', id, 'base', pair_base, 'quote', pair_quote,
                          'window', window_key, 'opening_ts', opening_ts, 'opening_price', opening_price),
       app_session_id,
       concat('repair-opening-', id::text),
       opening_ts
FROM strategy_aux.str_aux_session
WHERE opening_stamp = TRUE
  AND opening_ts IS NOT NULL
ON CONFLICT (idempotency_key) DO NOTHING;

CREATE OR REPLACE FUNCTION upsert_str_aux_opening(
  p_base TEXT, p_quote TEXT, p_window TEXT, p_app_session_id TEXT,
  p_opening_ts BIGINT, p_opening_price DOUBLE PRECISION,
  p_eta_pct DOUBLE PRECISION, p_eps_shift_pct DOUBLE PRECISION, p_k_cycles INT,
  p_idem TEXT
) RETURNS BIGINT AS $$
DECLARE v_id BIGINT;
BEGIN
  INSERT INTO strategy_aux.str_aux_session(
    pair_base, pair_quote, window_key, app_session_id,
    opening_stamp, opening_ts, opening_price,
    price_min, price_max, bench_pct_min, bench_pct_max,
    eta_pct, eps_shift_pct, k_cycles, last_update_ms,
    shifts, swaps, ui_epoch, above_count, below_count, shift_stamp,
    gfm_anchor_price, gfm_calc_price_last, gfm_r_last, gfm_delta_last,
    last_price
  ) VALUES (
    p_base, COALESCE(p_quote,'USDT'), p_window, p_app_session_id,
    TRUE, p_opening_ts, p_opening_price,
    p_opening_price, p_opening_price, 0, 0,
    p_eta_pct, p_eps_shift_pct, p_k_cycles, p_opening_ts,
    0, 0, 0, 0, 0, FALSE,
    p_opening_price, NULL, NULL, NULL,
    p_opening_price
  )
  ON CONFLICT (pair_base, pair_quote, window_key, app_session_id)
  DO UPDATE SET
    opening_stamp   = TRUE,
    opening_ts      = EXCLUDED.opening_ts,
    opening_price   = EXCLUDED.opening_price,
    price_min       = EXCLUDED.opening_price,
    price_max       = EXCLUDED.opening_price,
    bench_pct_min   = 0, bench_pct_max = 0,
    eta_pct         = EXCLUDED.eta_pct,
    eps_shift_pct   = EXCLUDED.eps_shift_pct,
    k_cycles        = EXCLUDED.k_cycles,
    last_update_ms  = EXCLUDED.last_update_ms,
    shifts          = 0, swaps = 0, ui_epoch = 0,
    above_count     = 0, below_count = 0, shift_stamp = FALSE,
    gfm_anchor_price = EXCLUDED.opening_price,
    gfm_calc_price_last = NULL,
    gfm_r_last = NULL,
    gfm_delta_last = NULL,
    last_price = EXCLUDED.opening_price
  RETURNING id INTO v_id;

  INSERT INTO app_ledger(topic, event, payload, session_id, idempotency_key, ts_epoch_ms)
  VALUES ('str-aux','opening_set',
          jsonb_build_object('session_id',v_id,'base',p_base,'quote',p_quote,'window',p_window,
                             'opening_ts',p_opening_ts,'opening_price',p_opening_price),
          p_app_session_id, p_idem, p_opening_ts)
  ON CONFLICT (idempotency_key) DO NOTHING;

  RETURN v_id;
END;
$$ LANGUAGE plpgsql;

-- compact head (boolean stamp + when)
CREATE TABLE IF NOT EXISTS public.app_session_settings_head (
  app_session_id text PRIMARY KEY REFERENCES app_sessions(app_session_id) ON DELETE CASCADE,
  settings_applied boolean NOT NULL DEFAULT false,
  applied_at      timestamptz,
  updated_at      timestamptz NOT NULL DEFAULT now()
);

-- apply/update helper that also mirrors into the JSON table
CREATE OR REPLACE FUNCTION public.apply_session_settings(
  p_app_session_id text,
  p_payload jsonb,             -- { coins, windows, poller, SSR: {...}, SCR: {...}, ... }
  p_stamp boolean DEFAULT true
) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM public.ensure_app_session(p_app_session_id);

  -- store full JSON
  INSERT INTO public.app_session_settings(app_session_id, payload)
  VALUES (p_app_session_id, COALESCE(p_payload,'{}'::jsonb))
  ON CONFLICT (app_session_id) DO UPDATE
    SET payload = EXCLUDED.payload, updated_at = now();

  -- head/stamp
  INSERT INTO public.app_session_settings_head(app_session_id, settings_applied, applied_at)
  VALUES (p_app_session_id, p_stamp, CASE WHEN p_stamp THEN now() END)
  ON CONFLICT (app_session_id) DO UPDATE
    SET settings_applied = p_stamp,
        applied_at = CASE WHEN p_stamp THEN now() ELSE app_session_settings_head.applied_at END,
        updated_at = now();
END$$;


CREATE OR REPLACE FUNCTION public.upsert_app_session_settings(
  p_app_session_id text,
  p_payload jsonb
) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM public.ensure_app_session(p_app_session_id);

  INSERT INTO public.app_session_settings(app_session_id, payload)
  VALUES (p_app_session_id, COALESCE(p_payload,'{}'::jsonb))
  ON CONFLICT (app_session_id) DO UPDATE
    SET payload = EXCLUDED.payload, updated_at = now();
END$$;


CREATE TABLE IF NOT EXISTS public.app_session_settings_head (
  app_session_id   text PRIMARY KEY REFERENCES app_sessions(app_session_id) ON DELETE CASCADE,
  settings_applied boolean NOT NULL DEFAULT false,
  applied_at       timestamptz,
  updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION public.apply_session_settings(
  p_app_session_id text,
  p_payload jsonb,
  p_stamp boolean DEFAULT true
) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM public.ensure_app_session(p_app_session_id);

  INSERT INTO public.app_session_settings(app_session_id, payload)
  VALUES (p_app_session_id, COALESCE(p_payload,'{}'::jsonb))
  ON CONFLICT (app_session_id) DO UPDATE
    SET payload = EXCLUDED.payload, updated_at = now();

  INSERT INTO public.app_session_settings_head(app_session_id, settings_applied, applied_at)
  VALUES (p_app_session_id, p_stamp, CASE WHEN p_stamp THEN now() END)
  ON CONFLICT (app_session_id) DO UPDATE
    SET settings_applied = p_stamp,
        applied_at = CASE WHEN p_stamp THEN now() ELSE app_session_settings_head.applied_at END,
        updated_at = now();
END$$;

CREATE OR REPLACE FUNCTION upsert_str_aux_opening(
  p_base TEXT, p_quote TEXT, p_window TEXT, p_app_session_id TEXT,
  p_opening_ts BIGINT, p_opening_price DOUBLE PRECISION,
  p_idem TEXT
) RETURNS BIGINT AS $$
DECLARE v_id BIGINT;
BEGIN
  -- ensure global app session exists (safe no-op if present)
  PERFORM public.ensure_app_session(p_app_session_id);

  INSERT INTO strategy_aux.str_aux_session(
    pair_base, pair_quote, window_key, app_session_id,
    opening_stamp, opening_ts, opening_price,
    price_min, price_max, bench_pct_min, bench_pct_max,
    last_update_ms,
    -- HARD RESET of live counters & GFM anchors
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
    bench_pct_min  = 0, bench_pct_max = 0,
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
  VALUES ('str-aux','opening_set',
          jsonb_build_object('str_session_id',v_id,'base',p_base,'quote',p_quote,'window',p_window,
                             'opening_ts',p_opening_ts,'opening_price',p_opening_price),
          p_app_session_id, p_idem, p_opening_ts)
  ON CONFLICT (idempotency_key) DO NOTHING;

  RETURN v_id;
END;
$$ LANGUAGE plpgsql;
