-- 03_market.sql (lightweight)
set search_path = market, public;

-- === market function guards (drop-before-recreate) ===

-- Drop ANY previous sp_sync_from_settings_universe / sp_upsert_symbol overloads
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT p.oid, n.nspname, p.proname, pg_get_function_identity_arguments(p.oid) AS args
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'market'
      AND p.proname IN ('sp_sync_from_settings_universe','sp_upsert_symbol')
  LOOP
    EXECUTE format('DROP FUNCTION IF EXISTS %I.%I(%s);', r.nspname, r.proname, r.args);
  END LOOP;
END $$;

-- helper
create or replace function market._split_symbol(_s text)
returns table(base text, quote text) language sql as $$
  select
    nullif(regexp_replace(_s, '(.*)(USDT|FDUSD|USDC|BTC)$', '\1'), '') as base,
    nullif(regexp_replace(_s, '.*(USDT|FDUSD|USDC|BTC)$', '\1'), '')  as quote;
$$;

-- sp_upsert_symbol (no self-call)
create or replace function market.sp_upsert_symbol(
  _symbol text,
  _base   text,
  _quote  text,
  _status text default 'TRADING',
  _price_tick   numeric default null,
  _qty_step     numeric default null,
  _min_notional numeric default null,
  _metadata     jsonb   default '{}'::jsonb
) returns void language plpgsql as $$
begin
  perform market.sp_upsert_asset(_base);
  perform market.sp_upsert_asset(_quote);

  insert into market.symbols(
    symbol, base_asset, quote_asset, status,
    price_tick, qty_step, min_notional, metadata, updated_at
  )
  values (
    _symbol, _base, _quote, coalesce(_status,'TRADING'),
    _price_tick, _qty_step, _min_notional, coalesce(_metadata,'{}'::jsonb), now()
  )
  on conflict (symbol) do update
    set base_asset   = excluded.base_asset,
        quote_asset  = excluded.quote_asset,
        status       = excluded.status,
        price_tick   = excluded.price_tick,
        qty_step     = excluded.qty_step,
        min_notional = excluded.min_notional,
        metadata     = excluded.metadata,
        updated_at   = now();
end $$;

-- ONE canonical sp_sync_from_settings_universe
create or replace function market.sp_sync_from_settings_universe()
returns table(upserted int, disabled int)
language plpgsql as $$
declare
  have_universe boolean;
begin
  select exists (
    select 1 from information_schema.tables
    where table_schema='settings' and table_name='coin_universe'
  ) into have_universe;

  if not have_universe then
    return query select 0, 0;
    return;
  end if;

  with desired as (
    select cu.symbol,
           coalesce(cu.base_asset,(select base  from market._split_symbol(cu.symbol)))  as base_asset,
           coalesce(cu.quote_asset,(select quote from market._split_symbol(cu.symbol)))  as quote_asset
    from settings.coin_universe cu
    where cu.enabled = true
  ), upserts as (
    select count(*)::int as n from (
      select market.sp_upsert_symbol(
               upper(symbol)::text,
               upper(base_asset)::text,
               upper(quote_asset)::text,
               'TRADING'::text,
               null::numeric, null::numeric, null::numeric, '{}'::jsonb
             )
      from desired
    ) s
  )
  select n from upserts
  into upserted;

  with undesired as (
    select m.symbol
    from market.symbols m
    where not exists (
      select 1 from settings.coin_universe cu
      where cu.enabled = true and cu.symbol = m.symbol
    )
  ), updates as (
    update market.symbols m
       set status = 'OFF', updated_at = now()
     where m.symbol in (select symbol from undesired) and m.status <> 'OFF'
    returning 1
  )
  select coalesce(count(*),0)::int into disabled from updates;

  return query select upserted, disabled;
end $$;


-- ---------- CLEAN DROP GUARD (any previous signature) ----------
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT p.oid, n.nspname, p.proname, pg_get_function_identity_arguments(p.oid) AS args
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'market'
      AND p.proname IN ('sp_sync_from_settings_universe','sp_upsert_symbol')
  LOOP
    EXECUTE format('DROP FUNCTION IF EXISTS %I.%I(%s);', r.nspname, r.proname, r.args);
  END LOOP;
END $$;

-- === market function guards: drop existing overloads of functions we redefine ===
DO $$
DECLARE
  r record;
BEGIN
  -- adjust this list to the functions that 03_market.sql (re)defines
  FOR r IN
    SELECT p.proname,
           pg_get_function_identity_arguments(p.oid) AS args
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'market'
      AND p.proname = ANY (ARRAY[
        '_assets_pk_col',
        '_split_symbol',
        'apply_kline_from_payload',
        'apply_ticker_from_payload',
        'binance_interval_to_label',
        'ensure_asset',
        'ensure_symbol',
        'ensure_symbols',
        'parse_symbol_parts',
        'sp_apply_universe_symbols',
        'sp_ingest_kline_row',
        'sp_ingest_orderbook_levels',
        'sp_sync_from_settings_universe',
        'sp_upsert_asset',
        'sp_upsert_symbol',
        'sync_symbols_from_preview',
        'sync_wallet_assets_from_universe_helper',

        'upsert_wallet_balance'
      ])
  LOOP
    -- drop each overload by its exact identity arg list
    EXECUTE format('DROP FUNCTION market.%I(%s);', r.proname, r.args);
    RAISE NOTICE 'Dropped market.% (%)', r.proname, r.args;
  END LOOP;
END $$;

-- helper: drop a function if it exists with this exact argument signature
DO $$
BEGIN
  -- adjust the list below to every function you redefine in this file
  IF EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
             WHERE n.nspname='market' AND p.proname='ensure_symbol'
               AND pg_get_function_identity_arguments(p.oid)='text, text') THEN
    EXECUTE 'DROP FUNCTION market.ensure_symbol(text, text)';
  END IF;

  IF EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
             WHERE n.nspname='market' AND p.proname='upsert_kline'
               AND pg_get_function_identity_arguments(p.oid)='text, timestamp with time zone, text, numeric, numeric, numeric, numeric, numeric') THEN
    EXECUTE 'DROP FUNCTION market.upsert_kline(text, timestamptz, text, numeric, numeric, numeric, numeric, numeric)';
  END IF;

  -- add similar IF blocks for any other market.* functions you redefine
END $$;


-- === PREAMBLE: make functions re-definable even if return type changed ===
DO $$
DECLARE
  r record;
BEGIN
  -- List any market functions you redefine later in this file.
  -- Include every candidate you might have changed.
  FOR r IN
    SELECT
      n.nspname  AS schema_name,
      p.proname  AS func_name,
      pg_get_function_identity_arguments(p.oid) AS args
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'market'
      AND p.proname IN (
        'ensure_symbol',
        'upsert_symbol',
        'ensure_pair',
        'discover_symbols',
        'get_symbols',
        'api_symbols'
      )
  LOOP
    EXECUTE format(
      'DROP FUNCTION IF EXISTS %I.%I(%s) CASCADE',
      r.schema_name, r.func_name, r.args
    );
  END LOOP;
END$$;


-- ---------- A) TYPES ----------
do $$
begin
  if not exists (select 1 from pg_type where typname = 'orderbook_side_enum') then
    create type orderbook_side_enum as enum ('bid','ask');
  end if;
end$$;

-- ---------- B) ASSETS ----------
create table if not exists assets (
  asset_code   text primary key,     -- 'BTC'
  asset_name   text,
  precision_dp int  not null default 8,
  updated_at   timestamptz not null default now()
);
create index if not exists ix_assets_updated_at on assets(updated_at desc);

-- ---------- C) SYMBOLS ----------
create table if not exists symbols (
  symbol       text primary key,     -- 'BTCUSDT'
  base_asset   text not null references market.assets(asset_code) on update cascade,
  quote_asset  text not null references market.assets(asset_code) on update cascade,
  status       text not null default 'TRADING',   -- 'TRADING' | 'OFF' (for disabled)
  price_tick   numeric(38,18),
  qty_step     numeric(38,18),
  min_notional numeric(38,18),
  metadata     jsonb not null default '{}'::jsonb,
  updated_at   timestamptz not null default now()
);
create index if not exists ix_symbols_status on symbols(status);
create index if not exists ix_symbols_base   on symbols(base_asset);
create index if not exists ix_symbols_quote  on symbols(quote_asset);
create index if not exists ix_symbols_updated_at on symbols(updated_at desc);

comment on table symbols is
  'Trading pairs (independent catalog). Universe toggling writes to status.';

-- ---------- D) ORDERBOOK (ULTRA-LIGHT) ----------
-- Keep just a timestamped level store; no header rows.
create table if not exists orderbook_levels (
  symbol     text not null references market.symbols(symbol) on update cascade on delete cascade,
  ts         timestamptz not null,
  side       orderbook_side_enum not null,      -- 'bid' | 'ask'
  price      numeric(38,18) not null,
  qty        numeric(38,18) not null,
  primary key (symbol, ts, side, price)
);
create index if not exists ix_ob_levels_symbol_ts on orderbook_levels(symbol, ts);

comment on table orderbook_levels is 'Snapshot levels keyed by (symbol, ts, side, price).';

-- window_label ties to settings.windows; close_time aligns with on-conflict policies
create table if not exists klines (
  symbol                  text not null references market.symbols(symbol) on update cascade,
  window_label            text not null references settings.windows(window_label) on update cascade,
  open_time               timestamptz not null,
  close_time              timestamptz not null,
  open_price              numeric(38,18) not null,
  high_price              numeric(38,18) not null,
  low_price               numeric(38,18) not null,
  close_price             numeric(38,18) not null,
  volume                  numeric(38,18) not null,
  trades                  int,
  quote_volume            numeric(38,18),
  taker_buy_base_volume   numeric(38,18),
  taker_buy_quote_volume  numeric(38,18),
  source                  text not null default 'adapter',
  ingested_at             timestamptz not null default now(),
  primary key (symbol, window_label, close_time)
);
create index if not exists ix_klines_symbol_window_close
  on klines(symbol, window_label, close_time desc);

-- ---------- F) CORE UPSERT HELPERS ----------
create or replace function sp_upsert_asset(
  _asset_code text,
  _asset_name text default null,
  _precision  int  default null
) returns void language sql as $$
  insert into market.assets(asset_code, asset_name, precision_dp, updated_at)
  values (_asset_code, _asset_name, coalesce(_precision, 8), now())
  on conflict (asset_code) do update
    set asset_name   = excluded.asset_name,
        precision_dp = coalesce(excluded.precision_dp, market.assets.precision_dp),
        updated_at   = now();
$$;

-- ---------- FIXED sp_upsert_symbol (no self-call) ----------
CREATE FUNCTION market.sp_upsert_symbol(
  _symbol text,
  _base   text,
  _quote  text,
  _status text default 'TRADING',
  _price_tick   numeric default null,
  _qty_step     numeric default null,
  _min_notional numeric default null,
  _metadata     jsonb   default '{}'::jsonb
) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM market.sp_upsert_asset(_base);
  PERFORM market.sp_upsert_asset(_quote);

  INSERT INTO market.symbols(
    symbol, base_asset, quote_asset, status,
    price_tick, qty_step, min_notional, metadata, updated_at
  )
  VALUES (
    _symbol, _base, _quote, COALESCE(_status,'TRADING'),
    _price_tick, _qty_step, _min_notional, COALESCE(_metadata,'{}'::jsonb), now()
  )
  ON CONFLICT (symbol) DO UPDATE
    SET base_asset   = EXCLUDED.base_asset,
        quote_asset  = EXCLUDED.quote_asset,
        status       = EXCLUDED.status,
        price_tick   = EXCLUDED.price_tick,
        qty_step     = EXCLUDED.qty_step,
        min_notional = EXCLUDED.min_notional,
        metadata     = EXCLUDED.metadata,
        updated_at   = now();
END $$;

-- One-row insert for klines (idempotent)
create or replace function sp_ingest_kline_row(
  _symbol text,
  _window_label text,
  _open_time timestamptz,
  _close_time timestamptz,
  _open numeric,
  _high numeric,
  _low numeric,
  _close numeric,
  _volume numeric,
  _quote_volume numeric default null,
  _trades int default null,
  _taker_buy_base numeric default null,
  _taker_buy_quote numeric default null,
  _source text default 'adapter'
) returns void language sql as $$
  insert into market.klines(
    symbol, window_label, open_time, close_time,
    open_price, high_price, low_price, close_price,
    volume, quote_volume, trades,
    taker_buy_base_volume, taker_buy_quote_volume,
    source, ingested_at
  )
  values (
    _symbol, _window_label, _open_time, _close_time,
    _open, _high, _low, _close,
    _volume, _quote_volume, _trades,
    _taker_buy_base, _taker_buy_quote,
    coalesce(_source, 'adapter'), now()
  )
  on conflict (symbol, window_label, close_time) do update
    set open_price             = excluded.open_price,
        high_price             = excluded.high_price,
        low_price              = excluded.low_price,
        close_price            = excluded.close_price,
        volume                 = excluded.volume,
        quote_volume           = excluded.quote_volume,
        trades                 = excluded.trades,
        taker_buy_base_volume  = excluded.taker_buy_base_volume,
        taker_buy_quote_volume = excluded.taker_buy_quote_volume,
        source                 = excluded.source,
        ingested_at            = now();
$$;

-- Lightweight orderbook inserter
create or replace function sp_ingest_orderbook_levels(
  _symbol text,
  _ts     timestamptz,
  _bids   jsonb,       -- [[price, qty], ...]
  _asks   jsonb        -- [[price, qty], ...]
) returns void language plpgsql as $$
declare
  r jsonb;
begin
  -- bids
  for r in select * from jsonb_array_elements(coalesce(_bids,'[]'::jsonb)) loop
    insert into market.orderbook_levels(symbol, ts, side, price, qty)
    values (_symbol, _ts, 'bid', (r->>0)::numeric, (r->>1)::numeric)
    on conflict (symbol, ts, side, price) do update
      set qty = excluded.qty;
  end loop;

  -- asks
  for r in select * from jsonb_array_elements(coalesce(_asks,'[]'::jsonb)) loop
    insert into market.orderbook_levels(symbol, ts, side, price, qty)
    values (_symbol, _ts, 'ask', (r->>0)::numeric, (r->>1)::numeric)
    on conflict (symbol, ts, side, price) do update
      set qty = excluded.qty;
  end loop;
end$$;

-- ---------- G) COORDINATORS WITH settings.coin_universe ----------
-- These keep market catalog aligned with your enabled universe.
-- They’re defensive: only run work if settings.coin_universe exists.

-- Helper to split symbol -> (base, quote) if base/quote absent upstream.
create or replace function _split_symbol(_s text)
returns table(base text, quote text) language sql as $$
  select
    nullif(regexp_replace(_s, '(.*)(USDT|FDUSD|USDC|BTC)$', '\1'), '') as base,
    nullif(regexp_replace(_s, '.*(USDT|FDUSD|USDC|BTC)$', '\1'), '')  as quote;
$$;

--- ---------- ONE canonical sp_sync_from_settings_universe ----------
-- pick ONE return type. Here we expose counts, which is handy:
CREATE FUNCTION market.sp_sync_from_settings_universe()
RETURNS TABLE(upserted int, disabled int)
LANGUAGE plpgsql AS $$
DECLARE
  have_universe boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema='settings' AND table_name='coin_universe'
  ) INTO have_universe;

  IF NOT have_universe THEN
    RETURN QUERY SELECT 0, 0;
    RETURN;
  END IF;

  -- 1) ensure all enabled exist and are TRADING
  WITH desired AS (
    SELECT cu.symbol,
           COALESCE(cu.base_asset, (SELECT base  FROM market._split_symbol(cu.symbol)))  AS base_asset,
           COALESCE(cu.quote_asset,(SELECT quote FROM market._split_symbol(cu.symbol)))  AS quote_asset
    FROM settings.coin_universe cu
    WHERE cu.enabled = TRUE
  ), upserts AS (
    SELECT COUNT(*)::int AS n FROM (
      SELECT market.sp_upsert_symbol(
               UPPER(symbol)::text,
               UPPER(base_asset)::text,
               UPPER(quote_asset)::text,
               'TRADING'::text,
               NULL::numeric, NULL::numeric, NULL::numeric, '{}'::jsonb
             )
      FROM desired
    ) s
  )
  SELECT n INTO STRICT upserted FROM upserts;

  -- 2) mark undesired as OFF
  WITH undesired AS (
    SELECT m.symbol
    FROM market.symbols m
    WHERE NOT EXISTS (
      SELECT 1 FROM settings.coin_universe cu
      WHERE cu.enabled = TRUE AND cu.symbol = m.symbol
    )
  ), updates AS (
    UPDATE market.symbols m
       SET status = 'OFF', updated_at = now()
     WHERE m.symbol IN (SELECT symbol FROM undesired) AND m.status <> 'OFF'
    RETURNING 1
  )
  SELECT COALESCE(COUNT(*),0)::int INTO disabled FROM updates;

  RETURN QUERY SELECT upserted, disabled;
END $$;

-- Apply a specific set from the UI without touching settings (optional)
create or replace function sp_apply_universe_symbols(
  _symbols text[], _auto_disable boolean default true
) returns table(upserted int, disabled int) language plpgsql as $$
declare
  up int := 0;
  dis int := 0;
begin
  -- upsert desired
  with desired as (
    select distinct s as symbol from unnest(_symbols) s
  ), split as (
    select d.symbol,
           (select base  from _split_symbol(d.symbol)) as base_asset,
           (select quote from _split_symbol(d.symbol)) as quote_asset
    from desired d
  )
  select count(*) into up from (
    select sp_upsert_symbol(symbol, base_asset, quote_asset, 'TRADING') from split
  ) z;

  if _auto_disable then
    with undesired as (
      select m.symbol from market.symbols m
      where not exists (select 1 from desired d where d.symbol = m.symbol)
    ), updates as (
      update market.symbols m
         set status = 'OFF', updated_at = now()
       where m.symbol in (select symbol from undesired) and m.status <> 'OFF'
      returning 1
    )
    select coalesce(count(*),0) into dis from updates;
  end if;

  return query select up, dis;
end$$;

-- Optional convenience view
create or replace view v_symbols_universe as
select m.symbol, m.base_asset, m.quote_asset, m.status,
       coalesce(cu.enabled, false) as enabled_in_settings
from market.symbols m
left join settings.coin_universe cu on cu.symbol = m.symbol;


-- 03_market.sql (or a new patch file applied after it)

CREATE OR REPLACE FUNCTION market.sp_sync_from_settings_universe()
RETURNS integer
LANGUAGE plpgsql
AS $$
DECLARE
  has_symbol bool;
  r record;
  n int := 0;
  v_symbol text;
  v_base   text;
  v_quote  text;
  v_enabled bool;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='settings' AND table_name='coin_universe' AND column_name='symbol'
  ) INTO has_symbol;

  IF has_symbol THEN
    FOR r IN
      SELECT
        UPPER(NULLIF(symbol,''))::text AS symbol,
        UPPER(NULLIF(base_asset,''))::text AS base_asset,
        UPPER(COALESCE(NULLIF(quote_asset,''),'USDT'))::text AS quote_asset,
        COALESCE(enabled, true) AS enabled
      FROM settings.coin_universe
    LOOP
      v_symbol  := COALESCE(r.symbol, r.base_asset || r.quote_asset);
      v_base    := r.base_asset;
      v_quote   := r.quote_asset;
      v_enabled := r.enabled;

      PERFORM market.sp_upsert_symbol(
        v_symbol, v_base, v_quote,
        CASE WHEN v_enabled THEN 'TRADING' ELSE 'BREAK' END,
        NULL::numeric, NULL::numeric, NULL::numeric,
        '{}'::jsonb
      );
      n := n + 1;
    END LOOP;
  ELSE
    -- No 'symbol' column: synthesize it from base/quote
    FOR r IN
      SELECT
        UPPER(NULLIF(base_asset,''))::text AS base_asset,
        UPPER(COALESCE(NULLIF(quote_asset,''),'USDT'))::text AS quote_asset,
        COALESCE(enabled, true) AS enabled
      FROM settings.coin_universe
    LOOP
      v_symbol  := r.base_asset || r.quote_asset;
      v_base    := r.base_asset;
      v_quote   := r.quote_asset;
      v_enabled := r.enabled;

      PERFORM market.sp_upsert_symbol(
        v_symbol, v_base, v_quote,
        CASE WHEN v_enabled THEN 'TRADING' ELSE 'BREAK' END,
        NULL::numeric, NULL::numeric, NULL::numeric,
        '{}'::jsonb
      );
      n := n + 1;
    END LOOP;
  END IF;

  RETURN n;
END $$;

-- === SAFE RECREATE: market.sp_sync_from_settings_universe() ===

DO $$
BEGIN
  -- Drop pre-existing zero-arg function regardless of its return type
  IF EXISTS (
    SELECT 1
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'market'
      AND p.proname = 'sp_sync_from_settings_universe'
      AND p.proargtypes = ''::oidvector      -- zero-arg
  ) THEN
    EXECUTE 'DROP FUNCTION market.sp_sync_from_settings_universe()';
  END IF;
END $$;

CREATE FUNCTION market.sp_sync_from_settings_universe()
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  has_symbol boolean;
  r record;
  v_symbol  text;
  v_base    text;
  v_quote   text;
  v_enabled boolean;
BEGIN
  -- Does settings.coin_universe have 'symbol'?
  SELECT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema='settings'
      AND table_name='coin_universe'
      AND column_name='symbol'
  )
  INTO has_symbol;

  IF has_symbol THEN
    FOR r IN
      SELECT
        UPPER(NULLIF(symbol,''))::text                            AS symbol,
        UPPER(NULLIF(base_asset,''))::text                        AS base_asset,
        UPPER(COALESCE(NULLIF(quote_asset,''),'USDT'))::text      AS quote_asset,
        COALESCE(enabled, true)                                   AS enabled
      FROM settings.coin_universe
    LOOP
      v_symbol  := COALESCE(r.symbol, r.base_asset || r.quote_asset);
      v_base    := r.base_asset;
      v_quote   := r.quote_asset;
      v_enabled := r.enabled;

      PERFORM market.sp_upsert_symbol(
        v_symbol::text,
        v_base::text,
        v_quote::text,
        (CASE WHEN v_enabled THEN 'TRADING' ELSE 'BREAK' END)::text,
        NULL::numeric, NULL::numeric, NULL::numeric,
        '{}'::jsonb
      );
    END LOOP;
  ELSE
    -- No symbol col: synthesize SYMBOL = BASE||QUOTE
    FOR r IN
      SELECT
        UPPER(NULLIF(base_asset,''))::text                        AS base_asset,
        UPPER(COALESCE(NULLIF(quote_asset,''),'USDT'))::text      AS quote_asset,
        COALESCE(enabled, true)                                   AS enabled
      FROM settings.coin_universe
    LOOP
      v_symbol  := r.base_asset || r.quote_asset;
      v_base    := r.base_asset;
      v_quote   := r.quote_asset;
      v_enabled := r.enabled;

      PERFORM market.sp_upsert_symbol(
        v_symbol::text,
        v_base::text,
        v_quote::text,
        (CASE WHEN v_enabled THEN 'TRADING' ELSE 'BREAK' END)::text,
        NULL::numeric, NULL::numeric, NULL::numeric,
        '{}'::jsonb
      );
    END LOOP;
  END IF;

  RETURN;
END $$;
