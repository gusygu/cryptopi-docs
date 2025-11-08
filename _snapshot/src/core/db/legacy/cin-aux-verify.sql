
-- cin-aux-verify.sql
-- Read-only verification of key CIN-AUX objects.
-- Safe to run multiple times.

\echo ==== CIN-AUX VERIFY: schema ====
SELECT nspname AS schema
FROM pg_namespace
WHERE nspname = 'strategy_aux';

\echo ==== CIN-AUX VERIFY: core tables (subset) ====
SELECT relname AS table
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'strategy_aux'
  AND c.relkind = 'r'
  AND relname IN ('cin_move','cin_lot','cin_balance','cin_move_lotlink')
ORDER BY relname;

\echo ==== CIN-AUX VERIFY: views ====
SELECT relname AS view
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'strategy_aux'
  AND c.relkind = 'v'
  AND relname IN ('v_cin_move_attrib','v_cin_session_rollup')
ORDER BY relname;

\echo ==== CIN-AUX VERIFY: functions ====
SELECT p.proname AS function, pg_get_function_identity_arguments(p.oid) AS args
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'strategy_aux'
  AND p.proname IN ('cin_exec_move_v2','cin_ensure_balance_row','cin_consume_fifo_lots')
ORDER BY p.proname;

\echo ==== CIN-AUX VERIFY: constraints (subset) ====
SELECT conname, relname AS on_table
FROM pg_constraint co
JOIN pg_class cl ON cl.oid = co.conrelid
JOIN pg_namespace n ON n.oid = cl.relnamespace
WHERE n.nspname = 'strategy_aux'
  AND conname IN ('chk_cin_move_comp_sum_nonneg','chk_cin_lot_units')
ORDER BY conname;

\echo ==== CIN-AUX VERIFY: sample selects from views (no rows is OK) ====
SELECT * FROM strategy_aux.v_cin_move_attrib ORDER BY ts DESC LIMIT 3;
SELECT * FROM strategy_aux.v_cin_session_rollup ORDER BY session_id LIMIT 3;

\echo ==== DONE ====
