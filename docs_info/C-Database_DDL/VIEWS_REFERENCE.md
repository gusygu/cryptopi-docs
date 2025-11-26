VIEWS_REFERENCE.md
Purpose

While SCHEMAS_REFERENCE.md explains where things live, this document focuses on the key views that form the primary surface area for:

Client UI reads

Jobs and daemons

Smokes and vitals

Only the most structurally important views are listed; the database may contain more supporting ones.

1. Session & Ops Views
ops.v_session_flags

One row per schema, describing whether the current session is open for that schema and when it was last updated.

Feeds schema-specific v_session_open views and the vitals layer.

settings.v_session_open

View over ops.session_flags constrained to the settings schema.

Lets code and smokes quickly know if configuration session is considered open.

market.v_session_open

Session reflection scoped to market operations.

These views are the runtime truth of whether a given schema believes the app is “open” or not.

2. Universe & Settings Views
settings.v_coin_universe_simple

Simplified projection of settings.coin_universe for the UI and jobs.

Usually exposes symbol, base, quote, and enabled state.

settings.v_profile_binance

Shows how the configured universe relates to Binance’s reality.

Useful for catching symbols that exist in settings but not in Binance metadata (or vice versa).

market.v_symbols_universe

Mirrors the universe view on the market side.

Helps validate that symbols present in market.symbols match those in settings.coin_universe.

These views collectively define the operational universe that all jobs and engines must respect.

3. Structural & Sampling Views (str_aux)
str_aux.samples_latest

Latest structural samples per symbol/window.

Typically consumed by matrices and diagnostic dashboards.

str_aux.stats_latest

High-level statistics (density, gaps, windows reached) for each symbol/window.

str_aux.v_ingest_targets

List of (symbol, window) combinations that ingest and sampling should actively feed.

Built from settings.coin_universe + window definitions.

str_aux.v_stats_coverage

Matrix-style view of coverage: for each symbol and window, how many structural entries exist.

str_aux.v_stats_vectors_gaps

Focused on gaps and anomalies in structural vectors.

str_aux.vectors_latest

Fast-access view of latest structural vectors.

str_aux.window_panel_latest

Panel-like representation slicing across windows and symbols.

These views underpin both coverage smokes and higher-level analytics.

4. Matrices Views (matrices, public)
matrices.latest

Latest dynamic value per series.

Internal building block that powers more user-friendly public views.

matrices.v_pair_universe

How pairs (e.g. BTC/USDT) are represented inside the matrices world.

public.dyn_matrix_values

Public gateway to dynamic matrix values.

Often used as a generic analytical surface for external tools.

public.id_pct

Core id_pct matrix representation; exposes percentage changes across windows/universe.

public.id_pct_latest

Latest id_pct snapshot, ideal for UI and dashboards.

public.id_pct_pairs

Pair-wise representation of id_pct relationships.

public.str_vectors

Exposes structural vectors (from str_aux) in a public-friendly way.

These views make matrices consumable without deep schema knowledge.

5. Flow & Cinematic Views (cin_aux, strategy_aux)
cin_aux.cin_grid_view

Grid-style view over cinematic data (sessions, flows, balances) for inspection.

cin_aux.v_mea_alignment

Shows how cinema-like flows align with mood outputs.

cin_aux.v_mea_alignment_scored

Adds scored metrics to the alignment for diagnostics.

cin_aux.v_rt_asset_pnl

Real-time PnL aggregated per asset.

cin_aux.v_rt_move_pnl

PnL per move, useful for understanding which flows helped or hurt.

cin_aux.v_rt_session_recon

Reconciliation view per runtime session; ideal for debugging balance inconsistencies.

cin_aux.v_rt_session_summary

Compact summary of a cinematic session.

strategy_aux.cin_balance

Strategy-flavored interpretation of balances using cinematic data.

strategy_aux.cin_session

Strategy-layer view over sessions.

Collectively, these views provide the narrative of how value moves through the system.

6. Mood & Dynamics Views (mea_dynamics)
mea_dynamics.dynamics_latest

Latest mood dynamics snapshot by key.

Often used as a primary entry point for mood-related UI.

mea_dynamics.latest_cooled_cycle

Last stable ("cooled") cycle of the mood engine.

Helps ensure the UI is not reading half-processed cycles.

mea_dynamics.mea_latest_per_symbol

Compact mood metrics per symbol (tier, stability, traction, etc.).

These views anchor the mood surfaces seen by end users and vitals.

7. Wallet & Vitals Views (vitals)
vitals.wallets

High-level wallet health: number of wallets, basic distributions, possible issues.

vitals.object_counts

Count summary per major table or schema; quick way to see if a subsystem is empty or overgrown.

vitals.matrices_health

Health indicators for matrices (missing data, skew, etc.).

vitals.dynamics_health

Health view for mood/dynamics (staleness, cycles, anomalies).

vitals.latest_runs

Shows recent session runs, durations, and statuses.

vitals.role_db_settings

Cross-view of roles vs DB settings; useful when debugging permissions.

vitals.search_path_effective

Shows effective search_path for connections that care about schema resolution.

These vitals views are first-stop tools when something looks off in the UI or during smokes.

8. Debug Views (debug)
debug._ob_src

Safe alias for orderbook source; returns empty but typed results if underlying tables are missing.

debug._klines_win

Helper for inspecting kline sequences by window.

debug.universe

Quick at-a-glance overlay of configured vs observed universe.

debug.source_coverage

Coverage metrics per data source.

debug.straux_coverage

Coverage metrics specifically for str_aux tables.

debug.straux_gaps

Focus on gaps in str_aux data.

debug.perms

Snapshot of effective permissions.

Together, these views dim the lights and show where the wires are when the system misbehaves.

9. How to Use This Reference

When writing a query, start with the schema reference to pick the right home.

When debugging, start with vitals and debug views before digging into raw tables.

When adding new features, prefer ext / strategy_aux for experimental surfaces and later promote them into core schemas once stable.

This separation of schemas and views is what lets CryptoPi evolve safely while staying readable.