# Architecture - Modules Overview

CryptoPi Dynamics is intentionally split into thin vertical modules so ingestion, structural analytics, flows, and presentation stay independently testable. Each module is backed by a schema under `src/core/db/ddl`, typed services under `src/core`, and surface components under `src/app` + `src/components`. This document maps those modules to their runtime responsibilities.

## Runtime Surfaces

| Layer | What lives here | Key directories |
| --- | --- | --- |
| **Client & API** | Next.js server components + API routes that read/write via the core services. | `src/app`, `src/components`, `src/app/(server)` |
| **Engines** | Deterministic engines for matrices, str-aux, cin-aux, moo-aux plus schedulers. | `src/core/features/*`, `src/core/pipelines`, `src/core/poller` |
| **Persistence** | PostgreSQL schemas applied by `src/core/db/cli.ts` using the numbered DDL packs. | `src/core/db/ddl` |

`src/core/pipelines/pipeline.ts` orchestrates long-running jobs (ingestion, sampling, aggregation) while `src/core/poller` provides the timer grid that drives `str_aux` and matrices refresh cycles. Every API route consumes those services rather than bypassing them.

## Module Breakdown

### Settings (`02_settings.sql`)
- Source of truth for windows, parameters, and the enabled universe (`settings.windows`, `settings.params`, `settings.coin_universe`).
- Wallet/contact state sits next to configuration (`settings.wallets`, `settings.wallet_credentials`, `settings.external_accounts`) so UI screens under `src/app/settings/*` can CRUD without touching market tables.
- `settings.sp_sync_coin_universe` mirrors the UI-driven universe into `market.symbols` and seeds ingest cursors. Direct callers include `/api/market/preview/universe` and `src/core/settings/matrices.ts`.

### Ingest + Market (`16_ingest.sql`, `03_market.sql`)
- `ingest.*` keeps raw Binance payloads, cursors, and audit logs so replays are deterministic.
- `market.assets`, `market.symbols`, `market.klines`, and `market.orderbook_levels` form the normalized canonical layer used everywhere else. APIs under `/api/market/*` go through `src/core/sources/binance` adapters which hydrate these tables.
- Helper functions such as `market.sp_ingest_kline_row` and `settings.sp_mirror_universe_to_market` enforce consistency after every sync.

### STR-AUX (`08_str-aux.sql`)
- Provides the sampling pipeline (5 s samples -> 40 s cycles -> aligned windows) with deterministic rollers and helpers (`str_aux.samples_5s`, `str_aux.cycles_40s`, `str_aux.windows`).
- All structural metrics (vectors, inertia, volt, amp, disruption) are persisted via `str_aux.window_stats` / `str_aux.window_vectors` and surfaced in `/api/str-aux/*` by `src/core/features/str-aux/*`.
- Sampler orchestration exposes `str_aux.v_ingest_targets`, trigger-based mirroring, and `str_aux.tick_all()` which `src/core/pipelines/metronome.ts` calls when the poller wakes the sampling job.

### Matrices (`07_matrices.sql`)
- Light schema (`matrices.series`, `matrices.points`, `matrices.v_latest_points`) used by `src/core/features/matrices/matrices.ts` when calling `computeFromDbAndLive` to stitch DB history with live Binance benchmarks.
- The `/api/matrices` stack writes through `matrices.sp_put_point` and returns ready-to-display grids for `src/components/features/matrices`.
- Frozen flags and opening grids are stored as part of the series payload, enabling the UI "purple ring" semantics without extra storage.

### CIN-AUX (`09_cin-aux-core.sql`, `09_cin-aux-runtime.sql`)
- Runtime sessions (`cin_aux.sessions`), move ledger (`cin_aux.moves`), tau/imprint tables, and helper functions feed the Cin runtime UI (`src/components/features/cin-aux`).
- Service layer under `src/core/features/cin-aux/*` computes imprint/luggage metrics and exposes `applyMove`, `getSessionRollup`, and runtime API handlers under `/api/cin-aux`.
- Optional functions in `09_cin-aux-functions.sql` keep compatibility layers (CLI pack imports) but are isolated from the runtime path.

### MEA Dynamics + Moo-Aux (`12_mea_dynamics.sql`, `src/core/features/moo-aux/*`)
- `mea_dynamics.cycles`, `mea_dynamics.mea_symbol`, and `mea_dynamics.dynamics_snapshot` store cooled mood cycles + per-symbol tiers.
- Views like `mea_dynamics.dynamics_latest` give the Next.js `/matrices` and `/dynamics` pages instant "latest cooled cycle" reads.
- Moo-Aux builds allocation matrices (`src/core/features/moo-aux/grid.ts`) by combining matrices id_pct grids with wallet balances, tier rules, and mood coefficients that get saved back into `mea_mood_observations`.

### Wallet (`05_wallet.sql`) and Ops/Docs (`04_documents.sql`, `13_ops.sql`)
- Wallet schema records moves, balances, and API credentials separate from cin-aux runtime data; the Settings UI only touches these tables.
- `ops.session_flags`, `ops.session_log`, and audit tables unify observability. Admin panels (`src/app/admin/*`) read through `/api/admin/*` controllers backed by `src/core/system/tasks.ts` and `src/core/db/db.manager.ts`.
- The `docs` schema mirrors on-disk `docs_info` packs after deployment for provenance; the DDL keeps it optional.

### Utility + Extension Schemas (`00_schemas.sql`, `01_extensions.sql`, `20_cin_aux_views.sql`)
- `util` contains cross-schema helpers (e.g., `util.touch_updated_at` used by `settings.profile`).
- `ext` is the sandbox for Postgres extensions that do not belong to any business domain.
- Optional `strategy_aux`, `debug`, and `docs` schemas can be enabled per environment without affecting the main runtime.

## Cross-Module Wiring

1. **Universe changes** fire `pg_notify('settings_universe_changed', ...)` inside the STR-AUX DDL so the poller re-evaluates ingest targets without manual restarts.
2. **Pipelines** (`src/core/pipelines/run.ts`) hydrate matrices by calling Binance adapters -> `market.sp_ingest_kline_row` -> `str_aux.tick_all()` -> `matrices.composeMatrices`.
3. **Client routes** never query tables directly. They call service helpers (e.g., `/api/matrices/latest` -> `src/app/(server)/matrices/service.ts`) that enforce freeze logic, live/DB fusion, and cache busting.

Understanding these seams makes it easier to bolt on a new module: define a schema pack under `src/core/db/ddl`, build a service under `src/core/features`, wire it into the poller/pipelines if it needs scheduled work, and expose it through an API route plus client surface.
