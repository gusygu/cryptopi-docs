BEGIN;
-- one job per (symbol,window) to fetch klines; then compute vectors/matrices/mea
INSERT INTO ingest.jobs (kind, payload, scheduled_for)
SELECT 'fetch_klines', jsonb_build_object('symbol', cu.symbol, 'window', w.label), now()
FROM settings.coin_universe cu
JOIN settings.windows w ON true
WHERE cu.enabled = true
ON CONFLICT DO NOTHING;

-- Kick first compute passes
INSERT INTO ingest.jobs (kind, payload, scheduled_for) VALUES
('fetch_ticker', '{}', now()),
('fetch_orderbook', '{}', now()),
('compute_str_vectors', '{}', now()),
('compute_matrices', '{}', now()),
('compute_mea', '{}', now())
ON CONFLICT DO NOTHING;
COMMIT;
