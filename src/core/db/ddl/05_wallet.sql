-- 18_wallet.sql  — reactive wallet layer (fixed trigger signature)
BEGIN;

-- -------------------------------------------------------------------
-- 1) Canonical table
-- -------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS market.wallet_balances (
  asset        text NOT NULL,
  ts           timestamptz NOT NULL DEFAULT now(),
  free_amt     numeric NOT NULL DEFAULT 0,
  locked_amt   numeric NOT NULL DEFAULT 0,
  meta         jsonb   NOT NULL DEFAULT '{}'::jsonb,
  PRIMARY KEY (asset, ts)
);

-- -------------------------------------------------------------------
-- 2) Helper: seed new assets from settings.coin_universe (void)
-- -------------------------------------------------------------------
CREATE OR REPLACE FUNCTION market.sync_wallet_assets_from_universe_helper()
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO market.wallet_balances(asset, ts, free_amt, locked_amt, meta)
  SELECT cu.base_asset, now(), 0, 0, '{}'::jsonb
  FROM settings.coin_universe cu
  WHERE cu.enabled
    AND cu.base_asset IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM market.wallet_balances wb WHERE wb.asset = cu.base_asset
    );

  INSERT INTO market.wallet_balances(asset, ts, free_amt, locked_amt, meta)
  SELECT cu.quote_asset, now(), 0, 0, '{}'::jsonb
  FROM settings.coin_universe cu
  WHERE cu.enabled
    AND cu.quote_asset IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM market.wallet_balances wb WHERE wb.asset = cu.quote_asset
    );
END$$;

-- -------------------------------------------------------------------
-- 3) Trigger wrapper (must return TRIGGER)
-- -------------------------------------------------------------------
CREATE OR REPLACE FUNCTION market.sync_wallet_assets_from_universe_trg()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM market.sync_wallet_assets_from_universe_helper();
  RETURN NULL; -- statement-level trigger
END$$;

-- Drop/recreate trigger idempotently
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_wallet_sync_from_universe') THEN
    DROP TRIGGER trg_wallet_sync_from_universe ON settings.coin_universe;
  END IF;

  CREATE TRIGGER trg_wallet_sync_from_universe
    AFTER INSERT OR UPDATE OR DELETE ON settings.coin_universe
    FOR EACH STATEMENT
    EXECUTE FUNCTION market.sync_wallet_assets_from_universe_trg();
END$$;

-- -------------------------------------------------------------------
-- 4) Upsert convenience for external writers
-- -------------------------------------------------------------------
CREATE OR REPLACE FUNCTION market.upsert_wallet_balance(
  p_asset  text,
  p_free   numeric,
  p_locked numeric,
  p_meta   jsonb DEFAULT '{}'::jsonb
)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO market.wallet_balances(asset, ts, free_amt, locked_amt, meta)
  VALUES (upper(p_asset), now(), p_free, p_locked, coalesce(p_meta, '{}'::jsonb))
  ON CONFLICT (asset, ts) DO NOTHING;
END$$;

-- -------------------------------------------------------------------
-- 5) Read surfaces
-- -------------------------------------------------------------------
CREATE OR REPLACE VIEW market.wallet_balances_latest AS
SELECT DISTINCT ON (asset)
       asset,
       ts,
       free_amt,
       locked_amt,
       (free_amt + locked_amt) AS total_amt,
       meta
FROM market.wallet_balances
ORDER BY asset, ts DESC;

CREATE OR REPLACE VIEW public.balances AS
SELECT asset,
       (free_amt + locked_amt) AS amount,
       (extract(epoch FROM ts)*1000)::bigint AS ts_epoch_ms
FROM market.wallet_balances_latest;

COMMIT;
