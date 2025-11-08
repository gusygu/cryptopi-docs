-- 01) reference units (minute, hour, day) and canonical quotes
CREATE SCHEMA IF NOT EXISTS settings;

CREATE TABLE IF NOT EXISTS settings.time_units (
  unit text PRIMARY KEY CHECK (unit IN ('millisecond','second','minute','hour','day'))
);

INSERT INTO settings.time_units(unit) VALUES
('millisecond'),('second'),('minute'),('hour'),('day')
ON CONFLICT DO NOTHING;

-- 02) windows: amount + unit; duration_ms is *generated*, not manually seeded
CREATE TABLE IF NOT EXISTS settings.windows (
  window_label  text PRIMARY KEY,
  amount        integer NOT NULL CHECK (amount > 0),
  unit          text NOT NULL REFERENCES settings.time_units(unit),
  duration_ms   bigint GENERATED ALWAYS AS (
    CASE unit
      WHEN 'millisecond' THEN amount::bigint
      WHEN 'second'      THEN amount::bigint * 1000
      WHEN 'minute'      THEN amount::bigint * 60 * 1000
      WHEN 'hour'        THEN amount::bigint * 60 * 60 * 1000
      WHEN 'day'         THEN amount::bigint * 24 * 60 * 60 * 1000
    END
  ) STORED
);

-- 03) parsing helper: '15m', '1h', '4h', '1d' → (amount, unit, label)
CREATE OR REPLACE FUNCTION settings.parse_window_label(p_label text)
RETURNS TABLE(amount integer, unit text, norm_label text) LANGUAGE plpgsql AS $$
DECLARE
  m text;
  a integer;
  u text;
BEGIN
  -- try patterns like 1m / 15m / 4h / 1d
  m := regexp_replace(p_label, '^\s*([0-9]+)\s*([mhd])\s*$', '\1:\2');
  IF m IS NOT NULL AND m <> p_label THEN
    a := (split_part(m, ':', 1))::int;
    u := split_part(m, ':', 2);
    IF u = 'm' THEN u := 'minute';
    ELSIF u = 'h' THEN u := 'hour';
    ELSIF u = 'd' THEN u := 'day';
    END IF;
    RETURN QUERY SELECT a, u, (a::text || CASE u WHEN 'minute' THEN 'm' WHEN 'hour' THEN 'h' WHEN 'day' THEN 'd' END);
    RETURN;
  END IF;

  -- fallback: already normalized 'minute'/'hour'/'day' words like '15 minute'
  m := regexp_replace(p_label, '^\s*([0-9]+)\s*(minute|hour|day)s?\s*$', '\1:\2');
  IF m IS NOT NULL AND m <> p_label THEN
    a := (split_part(m, ':', 1))::int;
    u := split_part(m, ':', 2);
    RETURN QUERY SELECT a, u, (a::text || CASE u WHEN 'minute' THEN 'm' WHEN 'hour' THEN 'h' WHEN 'day' THEN 'd' END);
    RETURN;
  END IF;

  -- give up
  RETURN;
END $$;

-- 04) smart upsert: accepts ANY of (label) or (amount,unit)
CREATE OR REPLACE FUNCTION settings.upsert_window(
  p_window_label text DEFAULT NULL,
  p_amount integer DEFAULT NULL,
  p_unit text DEFAULT NULL
) RETURNS settings.windows LANGUAGE plpgsql AS $$
DECLARE
  a integer;
  u text;
  L text;
  rec settings.windows;
BEGIN
  -- if label given, parse it
  IF p_window_label IS NOT NULL THEN
    SELECT amount, unit, norm_label INTO a,u,L
    FROM settings.parse_window_label(p_window_label)
    LIMIT 1;
  END IF;

  -- fallbacks from explicit amount/unit
  a := COALESCE(a, p_amount);
  u := COALESCE(u, p_unit);
  IF L IS NULL THEN
    IF u = 'minute' THEN L := a::text || 'm';
    ELSIF u = 'hour' THEN L := a::text || 'h';
    ELSIF u = 'day' THEN L := a::text || 'd';
    ELSE
      RAISE EXCEPTION 'Unknown time unit %', u USING ERRCODE = '22023';
    END IF;
  END IF;

  INSERT INTO settings.windows(window_label, amount, unit)
  VALUES (L, a, u)
  ON CONFLICT (window_label)
  DO UPDATE SET amount = EXCLUDED.amount, unit = EXCLUDED.unit
  RETURNING * INTO rec;

  RETURN rec;
END $$;

-- 01) canonical quotes (used to split SYMBOL = BASE + QUOTE)
CREATE TABLE IF NOT EXISTS settings.quotes (
  quote_asset text PRIMARY KEY
);
INSERT INTO settings.quotes(quote_asset) VALUES
('USDT'),('BTC'),('ETH'),('BNB'),('BUSD')
ON CONFLICT DO NOTHING;

-- 02) coin universe (enabled + sort_order as in your DDL)
CREATE TABLE IF NOT EXISTS settings.coin_universe (
  symbol      text PRIMARY KEY,
  base_asset  text NOT NULL,
  quote_asset text NOT NULL REFERENCES settings.quotes(quote_asset),
  enabled     boolean NOT NULL DEFAULT true,
  sort_order  integer
);

-- 03) smart upsert: accept symbol only (auto-split) or explicit base/quote
CREATE OR REPLACE FUNCTION settings.upsert_symbol(
  p_symbol text,
  p_base text DEFAULT NULL,
  p_quote text DEFAULT NULL,
  p_enabled boolean DEFAULT TRUE,
  p_sort integer DEFAULT NULL
) RETURNS settings.coin_universe LANGUAGE plpgsql AS $$
DECLARE
  base text := p_base;
  quote text := p_quote;
  q settings.quotes%ROWTYPE;
  rec settings.coin_universe;
BEGIN
  IF base IS NULL OR quote IS NULL THEN
    -- try to split p_symbol with the longest matching known quote
    FOR q IN SELECT * FROM settings.quotes ORDER BY length(quote_asset) DESC LOOP
      IF right(upper(p_symbol), length(q.quote_asset)) = q.quote_asset THEN
        base  := left(upper(p_symbol), length(upper(p_symbol)) - length(q.quote_asset));
        quote := q.quote_asset;
        EXIT;
      END IF;
    END LOOP;
  END IF;

  IF base IS NULL OR quote IS NULL THEN
    RAISE EXCEPTION 'Could not infer base/quote from %', p_symbol USING ERRCODE='22023';
  END IF;

  INSERT INTO settings.coin_universe(symbol, base_asset, quote_asset, enabled, sort_order)
  VALUES (upper(p_symbol), upper(base), upper(quote), COALESCE(p_enabled, TRUE), p_sort)
  ON CONFLICT (symbol) DO UPDATE
    SET base_asset = EXCLUDED.base_asset,
        quote_asset = EXCLUDED.quote_asset,
        enabled = EXCLUDED.enabled,
        sort_order = COALESCE(EXCLUDED.sort_order, settings.coin_universe.sort_order)
  RETURNING * INTO rec;

  RETURN rec;
END $$;
