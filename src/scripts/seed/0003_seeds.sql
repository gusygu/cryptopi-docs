BEGIN;

-- 1) Settings defaults (matches your UI screenshots)
INSERT INTO settings.engine_params (id, coin_universe, histogram_len, benchmark_decimals, idpct_decimals, epsilon, eta, iota)
VALUES (1, 'BTC, ETH, BNB, SOL, ADA, USDT, XRP, XPL, PEPE, DOGE', 64, 4, 6, 0, 0, 0)
ON CONFLICT (id) DO UPDATE SET
  coin_universe = EXCLUDED.coin_universe,
  histogram_len = EXCLUDED.histogram_len,
  benchmark_decimals = EXCLUDED.benchmark_decimals,
  idpct_decimals = EXCLUDED.idpct_decimals,
  epsilon = EXCLUDED.epsilon,
  eta = EXCLUDED.eta,
  iota = EXCLUDED.iota,
  updated_at = now();

INSERT INTO settings.timing (id, primary_interval_ms, secondary_enabled, secondary_cycles, str_cycles_m30, str_cycles_h1, str_cycles_h3)
VALUES (1, 30000, true, 3, 45, 90, 270)
ON CONFLICT (id) DO UPDATE SET
  primary_interval_ms = EXCLUDED.primary_interval_ms,
  secondary_enabled   = EXCLUDED.secondary_enabled,
  secondary_cycles    = EXCLUDED.secondary_cycles,
  str_cycles_m30      = EXCLUDED.str_cycles_m30,
  str_cycles_h1       = EXCLUDED.str_cycles_h1,
  str_cycles_h3       = EXCLUDED.str_cycles_h3,
  updated_at          = now();

INSERT INTO settings.profile (id, nickname, timezone, language)
VALUES (1, NULL, 'America/Sao_Paulo', 'en')
ON CONFLICT (id) DO UPDATE SET
  timezone = EXCLUDED.timezone,
  language = EXCLUDED.language,
  updated_at = now();

-- 2) Sync universe → coin_universe → market.symbols → ingest cursors
-- Fire the trigger by “touching” engine_params
UPDATE settings.engine_params SET updated_at = now() WHERE id = 1;

-- 3) Create a control-plane session (UUID) matching default window
INSERT INTO cin_aux.sessions (window_label, window_bins, window_ms, opening_stamp, opening_ts, print_stamp)
SELECT '30m', (SELECT bins_default FROM settings.windows WHERE label='30m'), (SELECT duration_ms FROM settings.windows WHERE label='30m'),
       true, now(), false
ON CONFLICT DO NOTHING;

-- 4) Seed an external account status placeholder (no secrets)
INSERT INTO settings.external_accounts (provider, linked, account_hint, last_linked_at, key_fingerprint)
VALUES ('binance', false, NULL, NULL, NULL)
ON CONFLICT (provider) DO NOTHING;

COMMIT;
