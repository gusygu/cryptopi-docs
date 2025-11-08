-- seed_scan_test.sql — step-by-step scan of seeding prerequisites
DO $$
DECLARE
  syms text[];
  has_win text;
  has_coin bool;
  has_symbol bool;
  has_mat bool;
BEGIN
  RAISE NOTICE '🔍 Checking universe ...';
  SELECT COUNT(*)>0 INTO has_coin FROM settings.coin_universe;
  RAISE NOTICE '→ coin_universe present: %', has_coin;

  RAISE NOTICE '🔍 Collecting symbols ...';
  SELECT array_agg(symbol ORDER BY symbol) INTO syms FROM settings.coin_universe WHERE enabled;
  RAISE NOTICE '→ symbols array: %', syms;

  RAISE NOTICE '🔍 Checking windows ...';
  SELECT window_label INTO has_win FROM settings.windows WHERE window_label='1h' LIMIT 1;
  RAISE NOTICE '→ window_label found: %', has_win;

  RAISE NOTICE '🔍 Checking matrices registry ...';
  SELECT COUNT(*)>0 INTO has_mat FROM cin_aux.mat_registry;
  RAISE NOTICE '→ mat_registry rows: %', has_mat;

  RAISE NOTICE '✅ Scan complete.';
END$$;
