-- scripts/seeds/0001_seed_universe.sql
-- Seeds balances + pair availability + id_pct for ALL ordered pairs
-- in settings_coin_universe, so the matrices/UI always have data.

-- 0) Guard: if settings is empty, add a sensible default universe
WITH defaults(symbol) AS (
  VALUES
    ('USDT'),('BTC'),('ETH'),('BNB'),('SOL'),
    ('ADA'),('XRP'),('XPL'),('PEPE'),('DOGE')
),
ensured AS (
  INSERT INTO settings_coin_universe(symbol)
  SELECT d.symbol
  FROM defaults d
  WHERE NOT EXISTS (SELECT 1 FROM settings_coin_universe)
  ON CONFLICT DO NOTHING
  RETURNING symbol
)
SELECT 1 WHERE 1=0;

-- 1) Balances: ensure one snapshot for each asset in settings
WITH now_ms AS (SELECT (extract(epoch from now())*1000)::BIGINT AS t)
INSERT INTO balances (asset, amount, ts_epoch_ms)
SELECT s.symbol,
       CASE s.symbol
         WHEN 'USDT' THEN 10000
         ELSE 0
       END::numeric,
       (SELECT t FROM now_ms)
FROM settings_coin_universe s
ON CONFLICT DO NOTHING;

-- 2) Generate ALL ordered pairs (base != quote) from settings
WITH u AS (
  SELECT symbol FROM settings_coin_universe
),
pairs AS (
  SELECT b.symbol AS base, q.symbol AS quote
  FROM u b
  JOIN u q ON q.symbol <> b.symbol
)
-- availability snapshot
, now_ms AS (SELECT (extract(epoch from now())*1000)::BIGINT AS t)
INSERT INTO pair_availability (base, quote, tradable, ts_epoch_ms)
SELECT base, quote, TRUE, (SELECT t FROM now_ms)
FROM pairs
ON CONFLICT DO NOTHING;

-- 3) One id_pct snapshot for every pair so matrices aren’t empty
--    (small deterministic non-zero values)
WITH now_ms AS (SELECT (extract(epoch from now())*1000)::BIGINT AS t)
, u AS (SELECT symbol FROM settings_coin_universe)
, pairs AS (
  SELECT b.symbol AS base, q.symbol AS quote,
         row_number() OVER () AS rn
  FROM u b
  JOIN u q ON q.symbol <> b.symbol
)
INSERT INTO id_pct_pairs (base, quote, id_pct, ts_epoch_ms)
SELECT base, quote,
       /* pseudo-signal in (-1.5, +1.5) % range */
       ROUND( ( ( (rn * 0.137) - FLOOR(rn * 0.137) ) * 3.0 - 1.5 )::numeric, 4 ),
       (SELECT t FROM now_ms)
FROM pairs
ON CONFLICT DO NOTHING;
