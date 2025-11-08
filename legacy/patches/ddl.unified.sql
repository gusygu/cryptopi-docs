-- cryptopi-dynamics • unified schema (PostgreSQL ≥ 13)
-- Idempotent: safe to run multiple times.

BEGIN;

-- ============ CORE REFS ======================================================
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
  cycle_ts  bigint PRIMARY KEY,  -- epoch ms
  created_at timestamptz NOT NULL DEFAULT now()
);
-- Legacy compatibility: map type "snapshots" to jsonb (domain)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'snapshots') THEN
    CREATE DOMAIN snapshots AS jsonb;
  END IF;
END
$$;


-- ============ DYNAMICS MATRICES (history) ===================================
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

-- ============ INGEST NORMALIZATION (AUX INPUTS) ==============================
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

-- ============ STRATEGY AUX (STR-AUX) ========================================
CREATE SCHEMA IF NOT EXISTS strategy_aux;

-- Session row for (base, quote, window, app_session_id)
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

-- ============ COMPAT VIEW: session_openings (for TS code) ====================
-- Your math.ts queries `session_openings` (session_ts, opening_price).
-- We expose it as a view over STR-AUX session rows where opening_stamp = TRUE.
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

-- ============ TRANSFER LEDGER (execution-aware journal) ======================
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

-- ============ CIN (cycle + session accumulators) =============================
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

-- ============ AUX SNAPSHOTS (MEA grids for audit/replay) =====================
CREATE TABLE IF NOT EXISTS aux_mea_snapshots (
  ts_ms      bigint       NOT NULL,
  coins      text[]       NOT NULL,
  k          int          NOT NULL,
  grid       jsonb        NOT NULL,
  warnings   text[]       NOT NULL DEFAULT '{}',
  created_at timestamptz  NOT NULL DEFAULT now()
);

-- ===== OPTIONAL: helper index if dyn_matrix_values exists (latest by type) ===
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'dyn_matrix_values') THEN
    CREATE INDEX IF NOT EXISTS idx_dyn_matrix_values_latest
      ON dyn_matrix_values (matrix_type, ts_ms DESC, base, quote);
  END IF;
END $$;

-- ============ NEW: generic application ledger (low-friction events) =========
-- Keep transfer_ledger for routes; use app_ledger for light app/system events.
CREATE TABLE IF NOT EXISTS app_ledger (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  topic            text NOT NULL,            -- e.g. 'calc','api','pipeline'
  event            text NOT NULL,            -- e.g. 'dyn_matrix_upsert'
  payload          jsonb,
  session_id       text,
  idempotency_key  text UNIQUE,              -- optional for dedupe
  ts_epoch_ms      bigint NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now()
);

COMMIT;


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

-- Map "freezeshot_*" API to "reference_*" API without breaking old callers.
-- Idempotent: creates wrappers if needed.

DO $$
BEGIN
  -- create_reference: wraps create_freezeshot
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


-- Per-session reference preference for a (base,quote,window).
CREATE TABLE IF NOT EXISTS reference_prefs (
  app_session_id TEXT NOT NULL,
  base           TEXT NOT NULL,
  quote          TEXT NOT NULL DEFAULT 'USDT',
  window_key     TEXT NOT NULL DEFAULT '1h',
  ref_kind       TEXT NOT NULL CHECK (ref_kind IN ('opening','reference','metric','matrix','custom')),
  -- when kind='reference', ref_id is a snapshots.id; when 'metric', metric_key in metrics; when 'matrix', matrix_type in dyn_matrix_values
  ref_id         TEXT,
  -- hard override (when set, this wins)
  override_value DOUBLE PRECISION,
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (app_session_id, base, quote, window_key)
);

-- helpers
CREATE OR REPLACE FUNCTION upsert_reference_pref(
  p_app_session_id TEXT, p_base TEXT, p_quote TEXT, p_window TEXT,
  p_ref_kind TEXT, p_ref_id TEXT, p_override DOUBLE PRECISION
) RETURNS VOID AS $$
BEGIN
  INSERT INTO reference_prefs(app_session_id, base, quote, window_key, ref_kind, ref_id, override_value)
  VALUES (p_app_session_id, p_base, p_quote, p_window, p_ref_kind, p_ref_id, p_override)
  ON CONFLICT (app_session_id, base, quote, window_key)
  DO UPDATE SET ref_kind=EXCLUDED.ref_kind, ref_id=EXCLUDED.ref_id, override_value=EXCLUDED.override_value, updated_at=now();
END; $$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION get_reference_pref(
  p_app_session_id TEXT, p_base TEXT, p_quote TEXT, p_window TEXT
) RETURNS reference_prefs AS $$
BEGIN
  RETURN (
    SELECT * FROM reference_prefs
     WHERE app_session_id=p_app_session_id AND base=p_base AND quote=p_quote AND window_key=p_window
  );
END; $$ LANGUAGE plpgsql STABLE;

-- 040-mea-aux (Measures Aux) --------------------------------------------------
SET search_path TO "${SCHEMA}", public;

-- Table
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

-- Index
CREATE INDEX IF NOT EXISTS mea_aux_snapshots_lookup
  ON mea_aux_snapshots (app_session_id, base, quote, window_key, cycle_ts DESC);

-- Summary view
CREATE OR REPLACE VIEW v_mea_aux_summary AS
SELECT
  s.base,
  s.quote,
  s.window_key,
  COUNT(*)        AS samples,
  MAX(s.cycle_ts) AS last_cycle_ts
FROM mea_aux_snapshots s
GROUP BY 1,2,3;

-- === strategy_aux: snapshots ===============================================
create table if not exists strategy_aux_snapshots (
  id bigserial primary key,
  app_session_id text not null,
  pair text not null,
  win text not null,
  payload jsonb not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_straux_app_pair_win_time
  on strategy_aux_snapshots (app_session_id, pair, win, created_at desc);

create index if not exists idx_straux_payload_gin
  on strategy_aux_snapshots using gin (payload);
-- ============================================================================ 

-- Cycle Documents (per-cycle JSON audit for matrices, mea, cin, str)
-- One document per domain + app_session_id + cycle_ts
-- Use BIGINT epoch milliseconds consistently.

create table if not exists public.cycle_documents (
  domain           text        not null
    check (domain in ('matrices','mea','cin','str')),
  app_session_id   text        not null,
  cycle_ts         bigint      not null,         -- epoch ms (cycle boundary)
  payload          jsonb       not null,         -- full cycle “document” for the domain
  created_at       timestamptz not null default now(),
  -- optional: pointer fields for quick peeks (kept nullable to avoid strict coupling)
  pairs_count      int,
  rows_count       int,
  notes            text,
  constraint cycle_documents_pkey
    primary key (domain, app_session_id, cycle_ts)
);

-- Fast lookups for “latest per domain/app_session”
create index if not exists idx_cycle_documents_latest
  on public.cycle_documents (domain, app_session_id, cycle_ts desc);

-- Time & inspection helpers
create index if not exists idx_cycle_documents_created
  on public.cycle_documents (created_at desc);

-- JSONB inspection (filtering by keys occasionally)
create index if not exists idx_cycle_documents_payload_gin
  on public.cycle_documents using gin (payload);

comment on table public.cycle_documents is
  'Per-cycle JSON audit documents for matrices, mea, cin, str (one row per domain/app_session_id/cycle_ts).';

-- Helper: upsert one document (idempotent)
create or replace function public.upsert_cycle_document(
  p_domain         text,
  p_app_session_id text,
  p_cycle_ts       bigint,
  p_payload        jsonb,
  p_pairs_count    int default null,
  p_rows_count     int default null,
  p_notes          text default null
) returns void
language plpgsql
as $$
begin
  insert into public.cycle_documents (domain, app_session_id, cycle_ts, payload, pairs_count, rows_count, notes)
  values (p_domain, p_app_session_id, p_cycle_ts, p_payload, p_pairs_count, p_rows_count, p_notes)
  on conflict (domain, app_session_id, cycle_ts) do update
  set payload      = excluded.payload,
      pairs_count  = excluded.pairs_count,
      rows_count   = excluded.rows_count,
      notes        = excluded.notes,
      created_at   = now();
end;
$$;

-- (Optional) simple “latest doc” view per domain/app_session
create or replace view public.v_cycle_documents_latest as
select distinct on (domain, app_session_id)
       domain, app_session_id, cycle_ts, payload, created_at, pairs_count, rows_count, notes
from public.cycle_documents
order by domain, app_session_id, cycle_ts desc;

-- NOTE: role grants can be added after we finalize roles:
--   grant select on public.cycle_documents, public.v_cycle_documents_latest to cp_app;
--   grant insert, update on public.cycle_documents to cp_writer;
