# Database - Schema Reference

All persistent state lives inside PostgreSQL and is declared in `src/core/db/ddl`. The CLI (`pnpm run run-ddl` -> `src/core/db/cli.ts`/`src/core/db/migrate.ts`) applies these packs sequentially, so the numeric prefixes define both dependency order and idempotent reruns. This document summarizes each schema and points to the DDL pack that builds it.

## Applying the packs

1. `00_schemas.sql` / `01_extensions.sql` create empty schemas + shared extensions (`pgcrypto`, `uuid-ossp`) so subsequent packs can run without conditional logic.
2. `02_*` through `05_*` prepare configuration, documents, and wallet structures that every module references.
3. Execution packs (`07_matrices.sql`, `08_str-aux.sql`, `09_cin-aux-*.sql`, `12_mea_dynamics.sql`, `13_ops.sql`, `16_ingest.sql`, etc.) build the runtime tables.
4. Tail packs (`20_cin_aux_views.sql`, `21_auth.sql`, `22_auth-invites.sql`, `23_admin_action-log.sql`, `24_audit.sql`, `25_rls.sql`, `99_security.sql`) add optional views, auth helpers, and grants. Because every function/table is wrapped in guards (`CREATE TABLE IF NOT EXISTS`, `to_regclass` checks), re-running the packs is safe in dev/staging.

## Schemas at a glance

| Schema | DDL pack(s) | Core tables / views | Notes |
| --- | --- | --- | --- |
| `util` | `00_schemas.sql` | helper functions (`util.touch_updated_at`) | Shared triggers + SQL helpers referenced by other packs. |
| `settings` | `02_settings.sql` | `windows`, `params`, `profile`, `coin_universe`, `external_accounts`, `wallets`, `wallet_credentials`, `scr_rules`, `ccr_rules`, `universe_batch_ops`, `v_profile_binance`, `v_coin_universe_simple` | Owns the enabled universe and wallet metadata. Functions: `sp_upsert_window`, `sp_sync_coin_universe`, `sp_mirror_universe_to_market`, `sp_upsert_external_account`. Triggers notify `settings_universe_changed` so samplers react. |
| `docs` | `04_documents.sql` | `doc_registry`, `doc_hashes` (optional) | Carries provenance for doc bundles shipped alongside the repo; can be skipped in dev if not needed. |
| `wallet` | `05_wallet.sql` | `accounts`, `moves`, `snapshots` (see pack) | Reserved for per-user accounting. The Settings UI/API interacts only with these tables. |
| `market` | `03_market.sql` | `assets`, `symbols`, `orderbook_levels`, `klines`, helper fns `sp_upsert_asset`, `sp_upsert_symbol`, `sp_ingest_kline_row`, etc. | Normalized market data reused by matrices, str-aux, and wallet valuation. Mirrors `settings.coin_universe` via `settings.sp_mirror_universe_to_market`. |
| `ingest` | `16_ingest.sql` | `klines_raw`, `trades_raw`, cursors, load logs | Capture layer that stores exchange payloads exactly as received. Cursor tables let samplers resume deterministically. |
| `matrices` | `07_matrices.sql` | `series`, `points`, `v_series_symbol`, `v_latest_points`, `sp_put_point`, `sp_put_points_bulk` | Minimal TS-friendly schema for the matrices engine. Metadata lives in `series.target` JSON so the UI can render frozen flags, quotes, etc. |
| `str_aux` | `08_str-aux.sql` (plus `09_str-aux_autonomy.sql`) | `samples_5s`, `samples_5s_model`, `cycles_40s`, `windows`, `window_stats`, `window_vectors`, `sampling_specs`, `symbol_specs`, views (`v_enabled_symbols`, `v_latest_windows`, `v_ingest_targets`, `v_health`, `v_flow_gaps`) | Houses the sampler rollers and derived vectors. Exported functions: `upsert_sample_5s`, `sp_roll_cycle_40s`, `sp_roll_window_from_cycles`, `roll_all_cycles_between`, `try_roll_all_windows_now_for_all`, `tick_all`. |
| `cin_aux` | `09_cin-aux-core.sql`, `09_cin-aux-runtime.sql`, `09_cin-aux-functions.sql`, `10_cin-aux-runtime.sql`, `11_cin-aux-functions.sql` | `sessions`, `moves`, `balances`, `runtime_balances`, tau/imprint tables, packed views | Ledger and runtime reconciliation backing the Cin UI. Helpers compute imprint/luggage deltas and enforce FK links to `wallet` + `market`. |
| `mea_dynamics` / `mea` | `12_mea_dynamics.sql` + checks in previous packs | `cycles`, `mea_symbol`, `dynamics_snapshot`, views `latest_cooled_cycle`, `mea_latest_per_symbol`, `dynamics_latest` | Stores cooled mood cycles and tiers produced by Moo/MEA. Conditional FKs link to `cin_aux.sessions` and `settings.windows` when available. |
| `mea` | `10_cin-aux-runtime.sql` (legacy) | retained as compatibility layer | Not required for new deployments but kept for migrations. |
| `ops` | `13_ops.sql` + `21_auth.sql` + `23_admin_action-log.sql` + `24_audit.sql` | `session_flags`, `session_log`, `action_log`, `audit_log`, helper enums | System health journaling. Admin/API controllers in `src/app/api/admin/*` read these tables to render vitals, audit reports, and jobs dashboards. |
| `auth` | `21_auth.sql`, `22_auth-invites.sql` | `accounts`, `sessions`, `auth_invites`, `auth_invite_requests` | Supports the `/auth` routes by keeping invite flow state inside the DB. |
| `ext`, `strategy_aux`, `debug` | `00_schemas.sql`, `18_str-aux_support.sql`, `19_debug.sql`, `20_cin_aux_views.sql` | opt-in views, temp helpers, extension sandboxes | Safe to drop in development; packs guard against missing dependencies. |

## Helper functions and triggers worth knowing

- **Universe sync**: `settings.trg_coin_universe_sync` (in `09_str-aux_autonomy.sql`) mirrors symbols into `market.symbols`, seeds ingest cursors, and emits a NOTIFY so daemons refresh.
- **Sampler tick**: `str_aux.trg_after_sample_5s` automatically rolls 40 s cycles whenever a 5 s sample arrives. `str_aux.tick_all()` offers a one-shot refresh across the whole universe (used by `src/core/pipelines/metronome.ts`).
- **Matrices fusion**: `matrices.sp_ensure_series` and `matrices.sp_put_point` guarantee that UI/API writes stay idempotent, and `matrices.v_latest_points` provides the "latest per series" view for `/api/matrices/latest`.
- **Cin runtime**: packs under `09_cin-aux-*.sql` expose `cin_aux.sp_apply_move`, `cin_aux.sp_close_session`, tau helpers, and compatibility views consumed by `/api/cin-aux/runtime/*`.
- **Auth + invites**: `auth.sp_issue_session`, `auth.sp_consume_invite`, and the invite request views power `/api/auth/*` as well as the admin invite dashboard.

## Security, grants, and RLS

- `25_rls.sql` and `99_security.sql` keep RLS templates disabled by default. Once roles such as `cp_reader` / `cp_writer` exist, the packs grant scoped privileges (`grant usage on schema str_aux to cp_writer, cp_reader`, etc.) and leave commented policies ready to enable.
- Because `wallet_credentials` stores encrypted blobs, the DDL enforces `bytea` storage and recommends pgcrypto usage without hard-coding a cipher.
- Audit packs (`23_admin_action-log.sql`, `24_audit.sql`) append triggers that automatically capture actor/session context when admin routes mutate state.

## Operational pointers

- Migrations that cannot stay idempotent belong in `src/core/db/migrate.ts`; do not patch the numbered packs for one-off changes.
- `src/core/db/scripts/seed-hydrate.ts` and `seed-universe.ts` call into the same stored procedures documented above, so schema guarantees remain identical between scripted and UI operations.
- The DDL is deliberately verbose about drop guards-if you need to remove an object, delete it manually before re-running the pack to avoid surprising the deployment pipeline.
