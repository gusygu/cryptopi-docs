-- 06_compat_legacy.sql
-- Combined compatibility + market/matrices helpers.
-- Consolidates:
--   06_compat_legacy.sql
--   25_market_ticker_patch.sql
--   26_dynamic_symbols.sql
--   27_symbols_enrich.sql
--   28_ticker_latest_meta.sql
--   29_matrices_latest_patch.sql
--   31_matrices_dyn_values.sql
-- fast-fail on locks inside this file
SET LOCAL lock_timeout = '2s';


-- ============================================================================
-- Legacy compatibility shims (former 06_compat_legacy.sql)
-- ============================================================================
CREATE SCHEMA IF NOT EXISTS strategy_aux;

DO $$
BEGIN
  IF to_regclass('cin_aux.sessions') IS NOT NULL THEN
    EXECUTE 'CREATE OR REPLACE VIEW strategy_aux.cin_session AS
      SELECT session_id, status, meta FROM cin_aux.sessions';
  END IF;
END$$;

DO $$
BEGIN
  IF to_regclass('cin_aux.rt_balance') IS NOT NULL THEN
    EXECUTE 'CREATE OR REPLACE VIEW strategy_aux.cin_balance AS
      SELECT
        rb.session_id,
        rb.asset_id,
        rb.opening_principal  AS opening_principal_usdt,
        rb.opening_profit     AS opening_profit_usdt,
        rb.principal_usdt,
        rb.profit_usdt,
        rb.closing_principal,
        rb.closing_profit,
        rb.opening_stamp,
        rb.opening_session_id,
        rb.opening_ts,
        rb.print_stamp,
        rb.print_ts
      FROM cin_aux.rt_balance rb';
  END IF;
END$$;

DO $$
BEGIN
  IF to_regclass('cin_aux.rt_balance') IS NOT NULL THEN
    EXECUTE
      'CREATE OR REPLACE FUNCTION strategy_aux.cin_ensure_balance_row(p_session bigint, p_asset text)
        RETURNS void LANGUAGE plpgsql AS '
      || quote_literal(
        'BEGIN
           INSERT INTO cin_aux.rt_balance(session_id, asset_id)
           VALUES (p_session, upper(p_asset))
           ON CONFLICT DO NOTHING;
         END'
      )
      || ';';
  ELSE
    EXECUTE 'DROP FUNCTION IF EXISTS strategy_aux.cin_ensure_balance_row(bigint, text)';
  END IF;
END$$;

DO $$
BEGIN
  IF to_regclass('str_aux.vectors_latest') IS NOT NULL THEN
    EXECUTE 'CREATE OR REPLACE VIEW public.str_vectors AS
      SELECT * FROM str_aux.vectors_latest';
  ELSE
    EXECUTE 'DROP VIEW IF EXISTS public.str_vectors';
  END IF;
END$$;

CREATE SCHEMA IF NOT EXISTS matrices;

-- Drop legacy compatibility views so the real tables can be created below.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname = 'dyn_matrix_values'
      AND c.relkind = 'v'
  ) THEN
    EXECUTE 'DROP VIEW public.dyn_matrix_values';
  END IF;
END$$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'matrices'
      AND c.relname = 'dyn_values'
      AND c.relkind = 'v'
  ) THEN
    EXECUTE 'DROP VIEW matrices.dyn_values';
  END IF;
END$$;

CREATE TABLE IF NOT EXISTS public.metrics (
  metric_key   text PRIMARY KEY,
  ts_epoch_ms  bigint NOT NULL DEFAULT (extract(epoch from now())*1000)::bigint,
  value        numeric,
  updated_at   timestamptz NOT NULL DEFAULT now()
);

CREATE OR REPLACE VIEW public.id_pct_pairs AS
SELECT NULL::bigint AS ts_epoch_ms,
       NULL::text   AS base,
       NULL::text   AS quote,
       NULL::numeric AS id_pct
WHERE FALSE;

CREATE OR REPLACE VIEW public.id_pct_latest AS
SELECT NULL::text AS base,
       NULL::text AS quote,
       NULL::numeric AS id_pct
WHERE FALSE;

CREATE TABLE IF NOT EXISTS mea_dynamics.mea_mood_observations (
  observation_id  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  app_session_id  uuid,
  ts_ms           bigint NOT NULL,
  mn_label        text,
  weight          numeric,
  payload         jsonb DEFAULT '{}'::jsonb,
  created_at      timestamptz DEFAULT now()
);

DO $$
BEGIN
  IF to_regclass('cin_aux.rt_balance') IS NOT NULL
     AND to_regclass('cin_aux.rt_session') IS NOT NULL THEN
    EXECUTE 'CREATE OR REPLACE VIEW cin_aux.cin_grid_view AS
      SELECT
        b.session_id                     AS runtime_session_id,
        s.session_id                     AS runtime_session_id_confirm,
        mr.session_id                    AS mea_session_uuid,
        b.asset_id                       AS symbol,
        mr.value                         AS mea_value,
        mr.components                    AS mea_components,
        b.principal_usdt,
        b.profit_usdt,
        b.closing_principal,
        b.closing_profit,
        b.print_ts
      FROM cin_aux.rt_balance b
      JOIN cin_aux.rt_session s
        ON s.session_id = b.session_id
      LEFT JOIN cin_aux.mea_result mr
        ON mr.session_id::text = b.session_id::text
      ORDER BY b.session_id, b.asset_id';
  ELSE
    EXECUTE 'DROP VIEW IF EXISTS cin_aux.cin_grid_view';
  END IF;
END$$;

CREATE OR REPLACE FUNCTION strategy_aux.current_cp_session_uuid()
RETURNS uuid LANGUAGE sql AS
$$ SELECT gen_random_uuid() $$;

CREATE OR REPLACE VIEW public.id_pct AS
SELECT NULL::text AS base,
       NULL::text AS quote,
       NULL::numeric AS id_pct
WHERE FALSE;

-- ============================================================================
-- Market ticker + symbol helpers (former 25/26/27/28 scripts)
-- ============================================================================
CREATE TABLE IF NOT EXISTS market.ticker_ticks (
  symbol text NOT NULL,
  ts     timestamptz NOT NULL,
  price  numeric(38,18) NOT NULL
);

ALTER TABLE market.ticker_ticks
  ADD COLUMN IF NOT EXISTS meta jsonb NOT NULL DEFAULT '{}'::jsonb;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'market'
      AND indexname = 'ux_ticker_ticks_sym_ts'
  ) THEN
    EXECUTE 'CREATE UNIQUE INDEX ux_ticker_ticks_sym_ts
             ON market.ticker_ticks(symbol, ts)';
  END IF;
END$$;



CREATE TABLE IF NOT EXISTS market.ticker_latest (
  symbol text PRIMARY KEY,
  ts     timestamptz NOT NULL,
  price  numeric(38,18) NOT NULL,
  meta   jsonb NOT NULL DEFAULT '{}'::jsonb
);

ALTER TABLE market.ticker_latest
  ADD COLUMN IF NOT EXISTS meta jsonb NOT NULL DEFAULT '{}'::jsonb;

CREATE TABLE IF NOT EXISTS market.symbols (
  symbol text PRIMARY KEY,
  base   text,
  quote  text,
  status text NOT NULL DEFAULT 'TRADING',
  meta   jsonb NOT NULL DEFAULT '{}'::jsonb
);

ALTER TABLE market.symbols
  ADD COLUMN IF NOT EXISTS base   text,
  ADD COLUMN IF NOT EXISTS quote  text,
  ADD COLUMN IF NOT EXISTS status text  NOT NULL DEFAULT 'TRADING',
  ADD COLUMN IF NOT EXISTS meta   jsonb NOT NULL DEFAULT '{}'::jsonb;

CREATE OR REPLACE FUNCTION market.parse_symbol_parts(_sym text)
RETURNS TABLE(base text, quote text)
LANGUAGE sql IMMUTABLE AS $$
  WITH q AS (
    SELECT unnest(ARRAY[
      'USDT','USDC','FDUSD','BUSD','TUSD','DAI',
      'BTC','ETH','BNB',
      'TRY','EUR','BRL',
      'PAXG','USTC','TRX','XRP','SOL','ADA','DOGE','DOT','MATIC','LTC'
    ]) AS q
  )
  SELECT
    upper(substr(_sym, 1, length(_sym) - length(q))) AS base,
    upper(q)                                         AS quote
  FROM q
  WHERE upper(_sym) LIKE '%' || q
  ORDER BY length(q) DESC
  LIMIT 1
$$;

-- canonical ensure_symbol, defined early for all downstream DDLs
drop function if exists market.ensure_symbol(text);
drop function if exists market.ensure_symbols(text[]);

create or replace function market.ensure_symbol(_sym text)
returns void
language plpgsql as $$
declare
  s text := upper(_sym);
  b text; q text;
begin
  select base, quote into b, q
  from market.parse_symbol_parts(s);

  b := coalesce(b, s);
  q := coalesce(q, 'USDT');

  insert into market.symbols(symbol, base_asset, quote_asset, base, quote, status, meta)
  values (s, b, q, b, q, 'TRADING', '{}'::jsonb)
  on conflict (symbol) do nothing;
end$$;

create or replace function market.ensure_symbols(_symbols text[])
returns void
language plpgsql as $$
begin
  insert into market.symbols(symbol)
  select upper(s) from unnest(_symbols) s
  on conflict do nothing;
end$$;



DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ticker_ticks_symbol_fkey') THEN
    ALTER TABLE market.ticker_ticks
      ADD CONSTRAINT ticker_ticks_symbol_fkey
      FOREIGN KEY (symbol) REFERENCES market.symbols(symbol);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'klines_symbol_fkey') THEN
    ALTER TABLE market.klines
      ADD CONSTRAINT klines_symbol_fkey
      FOREIGN KEY (symbol) REFERENCES market.symbols(symbol);
  END IF;
END$$;

CREATE OR REPLACE FUNCTION market.apply_ticker_from_payload(_symbol text, _payload jsonb)
RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
  sym text := upper(_symbol);
  _ts timestamptz;
  _p  numeric;
BEGIN
  PERFORM market.ensure_symbol(sym);

  _ts := to_timestamp( COALESCE( (_payload->>'E')::bigint, (_payload->>'T')::bigint ) / 1000.0 );
  _p  := COALESCE( (_payload->>'p')::numeric, (_payload->>'c')::numeric );
  IF _ts IS NULL OR _p IS NULL THEN RETURN; END IF;

  INSERT INTO market.ticker_ticks(symbol, ts, price, meta)
  VALUES (sym, _ts, _p, _payload)
  ON CONFLICT (symbol, ts) DO UPDATE
    SET price = EXCLUDED.price,
        meta  = EXCLUDED.meta;

  INSERT INTO market.ticker_latest(symbol, ts, price, meta)
  VALUES (sym, _ts, _p, _payload)
  ON CONFLICT (symbol) DO UPDATE
    SET ts    = EXCLUDED.ts,
        price = EXCLUDED.price,
        meta  = EXCLUDED.meta;
END $$;

CREATE OR REPLACE FUNCTION market.apply_kline_from_payload(_symbol text, _interval text, _payload jsonb)
RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
  sym text := upper(_symbol);
  lbl text;
  k jsonb;
  t_open  timestamptz;
  t_close timestamptz;
BEGIN
  PERFORM market.ensure_symbol(sym);

  lbl := market.binance_interval_to_label(_interval);
  IF lbl IS NULL THEN RETURN; END IF;

  k := _payload->'k';
  t_open  := to_timestamp( (k->>'t')::bigint / 1000.0 );
  t_close := to_timestamp( (k->>'T')::bigint / 1000.0 );

  INSERT INTO market.klines(
    symbol, window_label, open_time, close_time,
    open_price, high_price, low_price, close_price,
    volume, trades, quote_volume,
    taker_buy_base_volume, taker_buy_quote_volume
  )
  VALUES (
    sym, lbl, t_open, t_close,
    (k->>'o')::numeric, (k->>'h')::numeric, (k->>'l')::numeric, (k->>'c')::numeric,
    (k->>'v')::numeric, (k->>'n')::bigint, (k->>'q')::numeric,
    (k->>'V')::numeric, (k->>'Q')::numeric
  )
  ON CONFLICT (symbol, window_label, close_time) DO UPDATE
    SET open_price  = EXCLUDED.open_price,
        high_price  = EXCLUDED.high_price,
        low_price   = EXCLUDED.low_price,
        close_price = EXCLUDED.close_price,
        volume      = EXCLUDED.volume,
        trades      = EXCLUDED.trades,
        quote_volume= EXCLUDED.quote_volume,
        taker_buy_base_volume  = EXCLUDED.taker_buy_base_volume,
        taker_buy_quote_volume = EXCLUDED.taker_buy_quote_volume;
END $$;

-- ============================================================================
-- Matrices helpers (former 29/31 scripts)
-- ============================================================================
CREATE OR REPLACE VIEW matrices.latest AS
SELECT
  s.symbol,
  k.window_label,
  k.close_time,
  k.close_price AS value
FROM market.klines k
JOIN market.symbols s USING (symbol)
WHERE k.window_label = '1m'
  AND k.close_time = (
    SELECT max(k2.close_time)
    FROM market.klines k2
    WHERE k2.symbol = k.symbol
      AND k2.window_label = k.window_label
  );

CREATE TABLE IF NOT EXISTS matrices.dyn_values (
  ts_ms        bigint           NOT NULL,
  matrix_type  text             NOT NULL CHECK (matrix_type IN ('benchmark','delta','pct24h','id_pct','pct_drv','ref','pct_ref')),
  base         text             NOT NULL,
  quote        text             NOT NULL,
  value        double precision NOT NULL,
  meta         jsonb            NOT NULL DEFAULT '{}'::jsonb,
  created_at   timestamptz      NOT NULL DEFAULT now(),
  PRIMARY KEY (ts_ms, matrix_type, base, quote)
);

CREATE INDEX IF NOT EXISTS idx_matrices_dyn_values_pair
  ON matrices.dyn_values (matrix_type, base, quote, ts_ms DESC);

CREATE TABLE IF NOT EXISTS matrices.dyn_values_stage (
  ts_ms         bigint           NOT NULL,
  matrix_type   text             NOT NULL,
  base          text             NOT NULL,
  quote         text             NOT NULL,
  value         double precision NOT NULL,
  meta          jsonb            NOT NULL DEFAULT '{}'::jsonb,
  app_session_id text,
  created_at    timestamptz      NOT NULL DEFAULT now(),
  PRIMARY KEY (ts_ms, matrix_type, base, quote)
);

CREATE OR REPLACE VIEW public.dyn_matrix_values AS
SELECT * FROM matrices.dyn_values;

-- SCHEMA ----------------------------------------------------------------------
create schema if not exists ops;

-- CENTRAL LOG: one row per app boot
create table if not exists ops.session_log (
  session_id uuid primary key default gen_random_uuid(),
  app_name   text not null,
  app_version text not null,
  opened_at  timestamptz not null default now(),
  host       text,
  pid        integer,
  note       text
);

-- FLAGS: one row per schema you want to “stamp”
create table if not exists ops.session_flags (
  schema_name text primary key,
  is_open     boolean not null default false,
  opened_at   timestamptz,
  opened_by   uuid references ops.session_log(session_id) on delete set null,
  updated_at  timestamptz not null default now()
);

-- keep updated_at fresh
create or replace function ops.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end$$;

drop trigger if exists trg_session_flags_touch on ops.session_flags;
create trigger trg_session_flags_touch
before update on ops.session_flags
for each row execute procedure ops.touch_updated_at();

-- open one schema
create or replace function ops.open_schema(p_schema text, p_session uuid)
returns void language plpgsql as $$
begin
  insert into ops.session_flags as f(schema_name, is_open, opened_at, opened_by)
  values (p_schema, true, now(), p_session)
  on conflict (schema_name) do update
    set is_open  = true,
        opened_at = excluded.opened_at,
        opened_by = excluded.opened_by;
end$$;

-- close one schema (optional helper)
create or replace function ops.close_schema(p_schema text)
returns void language plpgsql as $$
begin
  update ops.session_flags
     set is_open = false
   where schema_name = p_schema;
end$$;

-- the one-call boot opener
-- pass the list of schemas you want stamped
create or replace function ops.open_all_sessions(
  p_app_name    text,
  p_app_version text,
  p_schemas     text[] default array['settings','market','documents','wallet','matrices','str_aux','cin_aux','mea_aux']::text[]
)
returns int language plpgsql as $$
declare
  v_session uuid;
  v_count   int := 0;
  s text;
begin
  insert into ops.session_log (app_name, app_version, host, pid)
  values (p_app_name, p_app_version, inet_client_addr()::text, pg_backend_pid())
  returning session_id into v_session;

  foreach s in array p_schemas loop
    perform ops.open_schema(s, v_session);
    v_count := v_count + 1;
  end loop;

  return v_count;
end$$;

-- convenience read view
create or replace view ops.v_session_flags as
select schema_name, is_open, opened_at, opened_by, updated_at
from ops.session_flags
order by schema_name;
