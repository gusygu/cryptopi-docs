-- 03_market.sql — lean reboot
-- Creates: types, tables, indexes, helpers, upserts, ingest fns, and ONE sync fn.
-- Safe to re-run (drop-guards included). Assumes schema `settings` + table `settings.windows` exist.

-------------------------------
-- 0) SCHEMA & SEARCH PATH
-------------------------------
CREATE SCHEMA IF NOT EXISTS market;
SET search_path = market, public;

-------------------------------
-- 1) DROP GUARDS (exact overloads)
-------------------------------
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT p.oid,
           n.nspname  AS schema_name,
           p.proname  AS func_name,
           pg_get_function_identity_arguments(p.oid) AS args
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'market'
      AND p.proname IN (
        '_split_symbol',
        'sp_upsert_asset',
        'sp_upsert_symbol',
        'sp_ingest_kline_row',
        'sp_ingest_orderbook_levels',
        'sp_sync_from_settings_universe'
      )
  LOOP
    EXECUTE format('DROP FUNCTION IF EXISTS %I.%I(%s);', r.schema_name, r.func_name, r.args);
  END LOOP;
END $$;

-------------------------------
-- 2) TYPES
-------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typnamespace = 'market'::regnamespace AND typname = 'orderbook_side_enum')
  THEN
    CREATE TYPE market.orderbook_side_enum AS ENUM ('bid','ask');
  END IF;
END $$;

-------------------------------
-- 3) TABLES
-------------------------------
-- Assets
CREATE TABLE IF NOT EXISTS market.assets (
  asset_code   text PRIMARY KEY,               -- e.g. 'BTC'
  asset_name   text,
  precision_dp int  NOT NULL DEFAULT 8,
  updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_assets_updated_at ON market.assets(updated_at DESC);

-- Symbols
CREATE TABLE IF NOT EXISTS market.symbols (
  symbol       text PRIMARY KEY,               -- e.g. 'BTCUSDT'
  base_asset   text NOT NULL REFERENCES market.assets(asset_code) ON UPDATE CASCADE,
  quote_asset  text NOT NULL REFERENCES market.assets(asset_code) ON UPDATE CASCADE,
  status       text NOT NULL DEFAULT 'TRADING',      -- 'TRADING' | 'OFF'
  price_tick   numeric(38,18),
  qty_step     numeric(38,18),
  min_notional numeric(38,18),
  metadata     jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_symbols_status      ON market.symbols(status);
CREATE INDEX IF NOT EXISTS ix_symbols_base        ON market.symbols(base_asset);
CREATE INDEX IF NOT EXISTS ix_symbols_quote       ON market.symbols(quote_asset);
CREATE INDEX IF NOT EXISTS ix_symbols_updated_at  ON market.symbols(updated_at DESC);

-- Orderbook levels (ultra light)
CREATE TABLE IF NOT EXISTS market.orderbook_levels (
  symbol  text NOT NULL REFERENCES market.symbols(symbol) ON UPDATE CASCADE ON DELETE CASCADE,
  ts      timestamptz NOT NULL,
  side    market.orderbook_side_enum NOT NULL,
  price   numeric(38,18) NOT NULL,
  qty     numeric(38,18) NOT NULL,
  PRIMARY KEY (symbol, ts, side, price)
);
CREATE INDEX IF NOT EXISTS ix_ob_levels_symbol_ts ON market.orderbook_levels(symbol, ts);

-- Klines (OHLCV)
CREATE TABLE IF NOT EXISTS market.klines (
  symbol                  text NOT NULL REFERENCES market.symbols(symbol) ON UPDATE CASCADE,
  window_label            text NOT NULL REFERENCES settings.windows(window_label) ON UPDATE CASCADE,
  open_time               timestamptz NOT NULL,
  close_time              timestamptz NOT NULL,
  open_price              numeric(38,18) NOT NULL,
  high_price              numeric(38,18) NOT NULL,
  low_price               numeric(38,18) NOT NULL,
  close_price             numeric(38,18) NOT NULL,
  volume                  numeric(38,18) NOT NULL,
  trades                  int,
  quote_volume            numeric(38,18),
  taker_buy_base_volume   numeric(38,18),
  taker_buy_quote_volume  numeric(38,18),
  source                  text NOT NULL DEFAULT 'adapter',
  ingested_at             timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (symbol, window_label, close_time)
);
CREATE INDEX IF NOT EXISTS ix_klines_symbol_window_close
  ON market.klines(symbol, window_label, close_time DESC);

-------------------------------
-- 4) HELPERS / UPSERTS
-------------------------------
-- Split symbol → (base, quote) by common suffix quotes.
CREATE OR REPLACE FUNCTION market._split_symbol(_s text)
RETURNS TABLE(base text, quote text)
LANGUAGE sql AS $$
  SELECT
    NULLIF(regexp_replace(_s, '(.*)(USDT|FDUSD|USDC|BTC)$', '\1'), '') AS base,
    NULLIF(regexp_replace(_s, '.*(USDT|FDUSD|USDC|BTC)$', '\1'), '')  AS quote;
$$;

-- Upsert a single asset
CREATE OR REPLACE FUNCTION market.sp_upsert_asset(
  _asset_code text,
  _asset_name text DEFAULT NULL,
  _precision  int  DEFAULT NULL
) RETURNS void
LANGUAGE sql AS $$
  INSERT INTO market.assets(asset_code, asset_name, precision_dp, updated_at)
  VALUES (_asset_code, _asset_name, COALESCE(_precision, 8), now())
  ON CONFLICT (asset_code) DO UPDATE
    SET asset_name   = EXCLUDED.asset_name,
        precision_dp = COALESCE(EXCLUDED.precision_dp, market.assets.precision_dp),
        updated_at   = now();
$$;

-- Upsert a symbol (NO SELF-CALL)
CREATE OR REPLACE FUNCTION market.sp_upsert_symbol(
  _symbol text,
  _base   text,
  _quote  text,
  _status text DEFAULT 'TRADING',
  _price_tick   numeric DEFAULT NULL,
  _qty_step     numeric DEFAULT NULL,
  _min_notional numeric DEFAULT NULL,
  _metadata     jsonb   DEFAULT '{}'::jsonb
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

-------------------------------
-- 5) INGEST OPERATIONS
-------------------------------
-- Single kline upsert (idempotent by PK)
CREATE OR REPLACE FUNCTION market.sp_ingest_kline_row(
  _symbol text,
  _window_label text,
  _open_time timestamptz,
  _close_time timestamptz,
  _open numeric,
  _high numeric,
  _low numeric,
  _close numeric,
  _volume numeric,
  _quote_volume numeric DEFAULT NULL,
  _trades int DEFAULT NULL,
  _taker_buy_base numeric DEFAULT NULL,
  _taker_buy_quote numeric DEFAULT NULL,
  _source text DEFAULT 'adapter'
) RETURNS void
LANGUAGE sql AS $$
  INSERT INTO market.klines(
    symbol, window_label, open_time, close_time,
    open_price, high_price, low_price, close_price,
    volume, quote_volume, trades,
    taker_buy_base_volume, taker_buy_quote_volume,
    source, ingested_at
  )
  VALUES (
    _symbol, _window_label, _open_time, _close_time,
    _open, _high, _low, _close,
    _volume, _quote_volume, _trades,
    _taker_buy_base, _taker_buy_quote,
    COALESCE(_source,'adapter'), now()
  )
  ON CONFLICT (symbol, window_label, close_time) DO UPDATE
    SET open_price             = EXCLUDED.open_price,
        high_price             = EXCLUDED.high_price,
        low_price              = EXCLUDED.low_price,
        close_price            = EXCLUDED.close_price,
        volume                 = EXCLUDED.volume,
        quote_volume           = EXCLUDED.quote_volume,
        trades                 = EXCLUDED.trades,
        taker_buy_base_volume  = EXCLUDED.taker_buy_base_volume,
        taker_buy_quote_volume = EXCLUDED.taker_buy_quote_volume,
        source                 = EXCLUDED.source,
        ingested_at            = now();
$$;

-- Orderbook levels upsert (bids/asks arrays)
CREATE OR REPLACE FUNCTION market.sp_ingest_orderbook_levels(
  _symbol text,
  _ts     timestamptz,
  _bids   jsonb,
  _asks   jsonb
) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE r jsonb;
BEGIN
  FOR r IN SELECT * FROM jsonb_array_elements(COALESCE(_bids,'[]'::jsonb)) LOOP
    INSERT INTO market.orderbook_levels(symbol, ts, side, price, qty)
    VALUES (_symbol, _ts, 'bid', (r->>0)::numeric, (r->>1)::numeric)
    ON CONFLICT (symbol, ts, side, price) DO UPDATE SET qty = EXCLUDED.qty;
  END LOOP;

  FOR r IN SELECT * FROM jsonb_array_elements(COALESCE(_asks,'[]'::jsonb)) LOOP
    INSERT INTO market.orderbook_levels(symbol, ts, side, price, qty)
    VALUES (_symbol, _ts, 'ask', (r->>0)::numeric, (r->>1)::numeric)
    ON CONFLICT (symbol, ts, side, price) DO UPDATE SET qty = EXCLUDED.qty;
  END LOOP;
END $$;

-------------------------------
-- 6) UNIVERSE SYNC (single, canonical)
-------------------------------
-- Align market.symbols with settings.coin_universe:
--  - ensure enabled entries exist & are 'TRADING'
--  - mark non-listed ones 'OFF'
CREATE OR REPLACE FUNCTION market.sp_sync_from_settings_universe()
RETURNS TABLE(upserted int, disabled int)
LANGUAGE plpgsql AS $$
DECLARE
  has_universe boolean;
  has_symbol_col boolean;
  up int := 0;
  dis int := 0;
  r record;
  v_symbol text; v_base text; v_quote text; v_enabled boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema='settings' AND table_name='coin_universe'
  ) INTO has_universe;

  IF NOT has_universe THEN
    RETURN QUERY SELECT 0, 0;
    RETURN;
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='settings' AND table_name='coin_universe' AND column_name='symbol'
  ) INTO has_symbol_col;

  IF has_symbol_col THEN
    FOR r IN
      SELECT
        UPPER(NULLIF(cu.symbol,''))::text                                  AS symbol,
        UPPER(COALESCE(NULLIF(cu.base_asset,''),(SELECT base  FROM market._split_symbol(cu.symbol))))  AS base_asset,
        UPPER(COALESCE(NULLIF(cu.quote_asset,''),(SELECT quote FROM market._split_symbol(cu.symbol)))) AS quote_asset,
        COALESCE(cu.enabled, TRUE) AS enabled
      FROM settings.coin_universe cu
    LOOP
      v_symbol  := COALESCE(r.symbol, r.base_asset || r.quote_asset);
      v_base    := r.base_asset;
      v_quote   := r.quote_asset;
      v_enabled := r.enabled;

      PERFORM market.sp_upsert_symbol(
        v_symbol::text,
        v_base::text,
        v_quote::text,
        (CASE WHEN v_enabled THEN 'TRADING' ELSE 'OFF' END)::text,
        NULL::numeric, NULL::numeric, NULL::numeric, '{}'::jsonb
      );
      up := up + 1;
    END LOOP;
  ELSE
    -- no symbol col: require base/quote present in settings
    FOR r IN
      SELECT
        UPPER(NULLIF(cu.base_asset,''))::text AS base_asset,
        UPPER(COALESCE(NULLIF(cu.quote_asset,''),'USDT'))::text AS quote_asset,
        COALESCE(cu.enabled, TRUE) AS enabled
      FROM settings.coin_universe cu
    LOOP
      v_symbol  := r.base_asset || r.quote_asset;
      v_base    := r.base_asset;
      v_quote   := r.quote_asset;
      v_enabled := r.enabled;

      PERFORM market.sp_upsert_symbol(
        v_symbol::text,
        v_base::text,
        v_quote::text,
        (CASE WHEN v_enabled THEN 'TRADING' ELSE 'OFF' END)::text,
        NULL::numeric, NULL::numeric, NULL::numeric, '{}'::jsonb
      );
      up := up + 1;
    END LOOP;
  END IF;

  -- mark undesired as OFF
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
  SELECT COALESCE(COUNT(*),0)::int INTO dis FROM updates;

  RETURN QUERY SELECT up, dis;
END $$;

-------------------------------
-- 7) VIEW (optional convenience)
-------------------------------
CREATE OR REPLACE VIEW market.v_symbols_universe AS
SELECT m.symbol, m.base_asset, m.quote_asset, m.status,
       COALESCE(cu.enabled, FALSE) AS enabled_in_settings
FROM market.symbols m
LEFT JOIN settings.coin_universe cu ON cu.symbol = m.symbol;
