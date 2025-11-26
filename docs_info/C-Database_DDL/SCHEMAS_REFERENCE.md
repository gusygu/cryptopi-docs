SCHEMAS_REFERENCE.md
Purpose

This document is a catalogue of all schemas in the CryptoPi database and what each one is responsible for. It complements DATABASE.md and DDL_ORDER.md by acting as a quick reference when you are reading queries, debugging smokes, or wiring new modules.

Each section below covers:

Role of the schema in the overall system.

Key tables (where applicable).

Important views or functions.

Typical consumers (which modules or jobs use it).

util schema
Role

A compact toolbox of helper functions, types, and utilities that are reused across schemas. It should remain small and generic.

Typical contents

String / JSON utilities.

Time helpers and small translation functions.

Safe wrappers for common patterns used in multiple schemas.

Consumers

All other schemas; util is deliberately dependency-light and low in the stack.

settings schema
Role

The configuration brain of the system. It defines what the universe is, how windows are interpreted, and which symbols are currently participating.

Key tables

settings.coin_universe registry of symbols (base, quote, enabled flag, metadata).

settings.quotes reference data for quote currencies and conversions.

settings.time_units canonical units (second, minute, hour, day, etc.).

settings.windows labeled windows (e.g. 30m, 4h) with (amount, unit, duration_ms).

settings.universe_batch_ops helper queue for universe operations.

Representative views

settings.v_coin_universe_simple simplified list for UI and smokes.

settings.v_profile_binance how the Binance profile maps into the configured universe.

settings.v_session_open reflection of ops.session_flags for this schema.

Consumers

Jobs that need the active symbol list and window definitions.

Ingest and str_aux builders that must know which symbols and windows to target.

Admin tools for enabling/disabling assets and tuning windows.

market schema
Role

The canonical cleaned market layer sitting between raw ingest and structural engines. Everything upstream of structural analysis reads from here.

Key tables

market.symbols meta data for symbols (base, quote, precision, etc.).

market.assets registry of assets (BTC, ETH, USDT, etc.).

market.klines normalized candle data keyed by symbol + window + ts.

market.orderbook_levels snapshot of orderbook depth (if enabled).

market.ticker_ticks time series of ticker events.

market.ticker_latest convenience table for last known ticker per symbol.

market.account_trades durable store of account trades imported from Binance.

Representative views

market.v_symbols_universe mapping of configured universe → actual market presence.

market.v_session_open session reflection for market computations.

Consumers

str_aux sampling engine.

Wallet valuation logic.

Diagnostics, smokes, and debug helpers.

docs schema
Role

The database companion to the repo-level /docs directory. It exists so the DB can carry its own understanding of which documentation/version/hash pack is active.

Typical contents

Tables for document pack registrations and hashes.

References to VERSION / SOURCE_TAG values.

Anchors to external registrations (INPI, notary-like systems, etc.).

Consumers

Ops / registration tooling.

Potential future v_docs_* views for showing doc metadata in the UI.

wallet schema
Role

Portfolio and account abstraction layer. This is where raw moves (trades, deposits, withdrawals, transfers) are represented in a consistent, system-wide manner.

Typical tables (conceptual)

wallet.accounts logical wallet or account entities.

wallet.moves atomic moves (amount, asset, origin, target, ts).

wallet.snapshots aggregate snapshots of account state over time.

(The DDL pack currently focuses on core structures; some tables may be introduced progressively through migrations.)

Consumers

Client UI wallet screens.

cin_aux / matrices for value and flow attribution.

vitals / diagnostics for wallet health views.

matrices schema
Role

The matrix engine: turns raw and structural inputs into series of interpretable values that can be easily read by the UI or other modules.

Key tables

matrices.dyn_values storage for dynamic matrix values.

matrices.dyn_values_stage staging table for batch inserts and transformations.

Representative views

matrices.latest latest point per matrix / series.

matrices.v_pair_universe mapping of pairs/universe as seen by matrices.

Consumers

Public views public.id_pct, public.id_pct_latest, etc.

Mood engine (mea_dynamics) as one of its primary inputs.

Client UI matrices and any higher-level analytics.

str_aux schema
Role

The structural auxiliary engine. It owns window sampling and structural vector computation.

Key tables

str_aux.vectors structural vectors per symbol/window.

str_aux.stats window statistics: density, coverage, quality.

Representative views

str_aux.samples_latest latest structural samples.

str_aux.stats_latest compact snapshot of stats per symbol/window.

str_aux.v_ingest_targets which symbols/windows ingest should be feeding.

str_aux.v_stats_coverage matrix of coverage over universe × windows.

str_aux.v_stats_vectors_gaps gap analysis for structural vectors.

str_aux.vectors_latest fast access to latest structural vectors.

str_aux.window_panel_latest panel-like snapshot across windows.

Consumers

matrices (for pct and tier construction).

mea_dynamics (mood).

vitals and debug (coverage and health checks).

cin_aux schema
Role

The flow and cinematic engine. It treats movements as trajectories and interprets imprint, luggage, and balance over time.

Key tables

cin_aux.sessions analytic sessions.

cin_aux.session_coin_universe per-session view of the coin universe.

cin_aux.session_link links sessions to other contexts.

cin_aux.settings_coin_universe snapshot of settings for a session.

cin_aux.rt_session runtime session state.

cin_aux.rt_reference reference marks for runtime flows.

cin_aux.rt_move runtime representation of moves.

cin_aux.rt_move_lotlink link table between moves and lots.

cin_aux.rt_lot representation of lots.

cin_aux.rt_mark mark-to-market style valuations.

cin_aux.rt_balance balance per asset/context.

cin_aux.mat_registry registry of flow-related matrices.

cin_aux.mat_cell cell-level representation of flow matrices.

cin_aux.mea_result results feeding into mood.

Representative views

cin_aux.cin_grid_view grid representation of cinematic data.

cin_aux.v_mea_alignment how cin_aux aligns with mood.

cin_aux.v_mea_alignment_scored scored alignment for diagnostics.

cin_aux.v_rt_asset_pnl real-time PnL per asset.

cin_aux.v_rt_move_pnl PnL per move.

cin_aux.v_rt_session_recon reconciliation view for a runtime session.

cin_aux.v_rt_session_summary compact summary per session.

Consumers

mea_dynamics for mood and traction.

Wallet analytics.

Debug and vitals for flow-level sanity checks.

mea schema
Role

Legacy / transitional mood structures. New work should target mea_dynamics, but mea may still exist to support historical data or experiments.

Typical contents

Early-generation mood tables or views.

Prototypes for dynamics logic.

Consumers

Legacy reporting.

Ad-hoc tests when comparing old vs new mood engines.

mea_dynamics schema
Role

The current mood engine schema. It harmonizes signals from matrices, cin_aux, and structural engines.

Key tables

mea_dynamics.cycles mood engine cycles (per window, per run).

mea_dynamics.mood_registry registry of mood metrics.

mea_dynamics.mea_symbol symbol-level mood metrics.

mea_dynamics.mea_mood_observations individual observations feeding mood.

mea_dynamics.dynamics_snapshot pre-computed snapshots for UI.

Representative views

mea_dynamics.dynamics_latest latest dynamics snapshot per key.

mea_dynamics.latest_cooled_cycle last stable cycle for mood.

mea_dynamics.mea_latest_per_symbol compact view per symbol.

Consumers

Client mood screens.

vitals.dynamics_health.

Analytics for higher-level research.

ingest schema
Role

Append-only buffer for raw data as received from Binance.

Typical tables (conceptual)

(The 16_ingest pack focuses on structure and writers; table names may be introduced or refactored across versions.)

Raw klines per symbol + window.

Raw trades for each asset.

Cursor tables to track how far each symbol and window has been fetched.

Representative views

Mostly referenced indirectly via str_aux.v_ingest_targets and debug views.

Consumers

Market normalization pipeline.

Sampler and coverage diagnostics.

strategy_aux schema
Role

Sandbox for strategy-oriented helpers.

Representative views

strategy_aux.cin_balance strategy-flavored balance summary.

strategy_aux.cin_session strategy view over cinematic sessions.

Consumers

Experimental strategy modules.

Research functions that should not pollute core schemas.

ops schema
Role

The operational backbone of CryptoPi.

Key tables

ops.session_log log of runtime sessions (UUID, opened_at, closed_at, etc.).

ops.session_flags per-schema session open flags.

ops.app_ledger high-level application ledger entries.

ops.fill internal fill records for orders.

Representative views

ops.v_session_flags convenient view of flags for consumer schemas.

Consumers

All schema-specific v_session_open views.

Jobs & daemons (to anchor their work in a session).

vitals.latest_runs for operational summaries.

ext schema
Role

A safe space for extension-related helpers and external previews.

Key tables

ext.binance_symbols_preview helper table for inspecting Binance symbol metadata.

Consumers

settings / market syncing helpers.

Ad-hoc diagnostics during development.

public schema
Role

Public-facing views that expose cohesive analytics without forcing consumers to understand internal schemas.

Key tables

public.metrics generic metrics table for external monitoring.

Representative views

public.id_pct base id_pct matrix view.

public.id_pct_latest latest id_pct snapshot.

public.id_pct_pairs pairwise id_pct interpretation.

public.dyn_matrix_values generic access to dynamic matrix values.

public.str_vectors structural vector access for external tools.

Consumers

Client UI (through thin API wrappers).

External tools or dashboards in the future.

debug schema
Role

A diagnostic overlay designed to be safe even when parts of the system are missing or in flux.

Representative views

debug._ob_src safe alias for orderbook source.

debug._klines_win helper for kline/window inspection.

debug.universe quick view of universe-related coverage.

debug.source_coverage per-source coverage metrics.

debug.straux_coverage structural coverage metrics.

debug.straux_gaps gap-focused diagnostics.

debug.perms permission snapshots.

Consumers

Smokes and vitals.

Developers during debugging sessions.

vitals schema
Role

Higher-level health and vitals views that pull from multiple schemas at once.

Representative views

vitals.dynamics_health health status of the mood engine.

vitals.matrices_health health status of matrices.

vitals.latest_runs recent session runs and durations.

vitals.object_counts approximate object counts across schemas.

vitals.role_db_settings diagnostic view of DB role + settings alignment.

vitals.search_path_effective debug helper for effective search path.

vitals.wallets snapshot health view for wallets.

Consumers

Admin dashboards.

Operational checks, smokes, and incident triage.