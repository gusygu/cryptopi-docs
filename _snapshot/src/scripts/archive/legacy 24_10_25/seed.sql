WITH now_ms AS (SELECT (extract(epoch from now())*1000)::BIGINT AS t)
INSERT INTO balances (asset, amount, ts_epoch_ms)
SELECT * FROM (
  SELECT 'USDT', 10000, (SELECT t FROM now_ms) UNION ALL
  SELECT 'BTC',     1.20, (SELECT t FROM now_ms) UNION ALL
  SELECT 'ETH',    12.50, (SELECT t FROM now_ms) UNION ALL
  SELECT 'SOL',   350.00, (SELECT t FROM now_ms)
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
