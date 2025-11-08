
-- CORE TABLES / VIEWS
CREATE TABLE IF NOT EXISTS id_pct_pairs (
  base TEXT NOT NULL,
  quote TEXT NOT NULL,
  id_pct DOUBLE PRECISION NOT NULL,
  ts_epoch_ms BIGINT NOT NULL,
  PRIMARY KEY (base, quote, ts_epoch_ms)
);

CREATE OR REPLACE VIEW id_pct_latest AS
SELECT DISTINCT ON (base, quote)
  base, quote, id_pct, ts_epoch_ms
FROM id_pct_pairs
ORDER BY base, quote, ts_epoch_ms DESC;

CREATE TABLE IF NOT EXISTS metrics (
  metric_key TEXT NOT NULL,
  value DOUBLE PRECISION NOT NULL,
  ts_epoch_ms BIGINT NOT NULL,
  PRIMARY KEY (metric_key, ts_epoch_ms)
);

CREATE TABLE IF NOT EXISTS balances (
  asset TEXT NOT NULL,
  amount NUMERIC NOT NULL,
  ts_epoch_ms BIGINT NOT NULL,
  PRIMARY KEY (asset, ts_epoch_ms)
);

CREATE OR REPLACE VIEW wallet_balances_latest AS
SELECT DISTINCT ON (asset) asset, amount, ts_epoch_ms
FROM balances
ORDER BY asset, ts_epoch_ms DESC;

CREATE TABLE IF NOT EXISTS pair_availability (
  base TEXT NOT NULL,
  quote TEXT NOT NULL,
  tradable BOOLEAN NOT NULL,
  ts_epoch_ms BIGINT NOT NULL,
  PRIMARY KEY (base, quote, ts_epoch_ms)
);

-- INDEXES
CREATE INDEX IF NOT EXISTS idx_idpct_pairs_bq_ts ON id_pct_pairs (base, quote, ts_epoch_ms DESC);
CREATE INDEX IF NOT EXISTS idx_metrics_key_ts ON metrics (metric_key, ts_epoch_ms DESC);
CREATE INDEX IF NOT EXISTS idx_balances_asset_ts ON balances (asset, ts_epoch_ms DESC);
CREATE INDEX IF NOT EXISTS idx_availability_ts ON pair_availability (ts_epoch_ms DESC);

-- MINIMAL SEED
WITH now_ms AS (SELECT (extract(epoch from now())*1000)::BIGINT AS t)
INSERT INTO balances (asset, amount, ts_epoch_ms)
SELECT * FROM (
  SELECT 'USDT', 10000, (SELECT t FROM now_ms) UNION ALL
  SELECT 'BTC',   1.20, (SELECT t FROM now_ms) UNION ALL
  SELECT 'ETH',  12.50, (SELECT t FROM now_ms) UNION ALL
  SELECT 'SOL', 350.00, (SELECT t FROM now_ms)
) s ON CONFLICT DO NOTHING;

WITH now_ms AS (SELECT (extract(epoch from now())*1000)::BIGINT AS t)
INSERT INTO id_pct_pairs (base, quote, id_pct, ts_epoch_ms)
SELECT * FROM (
  SELECT 'BTC','USDT', 0.90, (SELECT t FROM now_ms) UNION ALL
  SELECT 'ETH','USDT', 0.60, (SELECT t FROM now_ms) UNION ALL
  SELECT 'SOL','USDT', 1.10, (SELECT t FROM now_ms) UNION ALL
  SELECT 'BTC','ETH',  0.30, (SELECT t FROM now_ms) UNION ALL
  SELECT 'ETH','BTC', -0.40, (SELECT t FROM now_ms) UNION ALL
  SELECT 'SOL','BTC',  1.20, (SELECT t FROM now_ms) UNION ALL
  SELECT 'BTC','SOL',  0.80, (SELECT t FROM now_ms) UNION ALL
  SELECT 'ETH','SOL',  0.20, (SELECT t FROM now_ms) UNION ALL
  SELECT 'SOL','ETH', -0.10, (SELECT t FROM now_ms)
) s ON CONFLICT DO NOTHING;

WITH now_ms AS (SELECT (extract(epoch from now())*1000)::BIGINT AS t)
INSERT INTO pair_availability (base, quote, tradable, ts_epoch_ms)
SELECT * FROM (
  SELECT 'BTC','USDT', true, (SELECT t FROM now_ms) UNION ALL
  SELECT 'ETH','USDT', true, (SELECT t FROM now_ms) UNION ALL
  SELECT 'SOL','USDT', true, (SELECT t FROM now_ms) UNION ALL
  SELECT 'BTC','ETH',  true, (SELECT t FROM now_ms) UNION ALL
  SELECT 'ETH','BTC',  true, (SELECT t FROM now_ms) UNION ALL
  SELECT 'SOL','BTC',  true, (SELECT t FROM now_ms) UNION ALL
  SELECT 'BTC','SOL',  true, (SELECT t FROM now_ms) UNION ALL
  SELECT 'ETH','SOL',  true, (SELECT t FROM now_ms) UNION ALL
  SELECT 'SOL','ETH',  true, (SELECT t FROM now_ms)
) s ON CONFLICT DO NOTHING;

