DDL_ORDER.md
DDL Application Order

The database is built through a numbered set of DDL files under db/ddl. They are applied sequentially by the tooling, and many files assume that all previous packs have already run.

This document describes the intended order and responsibility of each file.

00_schemas.sql

Creates all primary schemas:

util

settings

market

docs

wallet

matrices

str_aux

cin_aux

ingest

strategy_aux

mea

mea_dynamics

ops

ext

This file must always run first, as later packs rely on these schemas existing.

01_extensions.sql

Installs and configures PostgreSQL extensions and low level types.

Typical responsibilities:

Ensuring pgcrypto and other core extensions are available.

Creating helper types that are reused later.

This pack prepares the database for more advanced features used in later schemas.

02_a_ops_session_stamp.sql

Introduces the Ops session stamp infrastructure.

Responsibilities:

Create tables such as ops.session_log and ops.session_flags.

Provide functions to open and record sessions.

Prepare the ground for a single opening stamp per runtime.

This ensures that from the start, all subsequent packs can lean on a consistent session concept.

02_b_ops_open_guard.sql

Adds guarded helpers around session opening.

Key roles:

Functions that ensure open all sessions is invoked safely and idempotently.

Protection against multiple concurrent opening attempts.

The combination of 02 a and 02 b gives a robust skeleton for ops stamping.

02_settings.sql

Defines and refreshes the settings schema contents.

Highlights:

Drops existing settings views so the file can be re run cleanly.

Creates or updates core settings tables such as app_settings, coin_universe, and poller state.

Seeds initial configuration values where appropriate.

All later packs assume that settings.coin_universe and other basic structures exist.

03_market.sql

Creates the market schema tables and functions.

Typical pieces:

market.symbols meta table.

market.klines and related candle tables.

market.ticker tables and orderbook snapshots.

Helper functions to upsert symbols from settings.coin_universe.

This pack bridges the configuration reality of settings with concrete structures for market data.

04_documents.sql

Sets up the docs schema and any supporting tables for documentation, version stamps, and registration references.

Responsibilities may include:

Tables for doc pack references.

Version and hash storage.

Basic access helpers.

This pack allows the database to know which documentation state it believes it is in.

05_wallet.sql

Introduces the wallet schema core tables.

Key structures:

Accounts and logical wallet groupings.

wallet.moves as atomic movement units.

Snapshot and valuation tables.

Later packs such as cin aux views and ingest helpers will integrate with wallet.moves.

06_compat_ops.sql

Compatibility layer for Ops.

Used to:

Bridge older ops layouts with the modern ops schema.

Provide helper views and functions so legacy code continues to work.

In fresh deployments it has minimal footprint, but in migrations it smooths the transition.

07_matrices.sql

Defines the matrices schema.

Main components:

matrices.series table for named series.

matrices.points table for time based values.

matrices.points_latest view for quick access to the most recent point per series.

Helper function sp_ensure_series to create or fetch series ids.

This is the foundation on which higher level percentage matrices and composite interpretations will build.

08_str-aux.sql

Core STR AUX runtime.

Responsibilities:

Ensure str_aux schema exists and is on the search path.

Clean up old str_aux functions to allow create or replace behaviour.

Define canonical window seconds for labels.

Create sampling and window tables and their helper functions.

This pack is central to windowed computation and must run after market and settings are ready.

09_cin-aux-core.sql

Initial cin aux pack.

Key elements:

Creation of cin_aux schema if missing.

cin_aux.sessions table for analytic sessions with window label and bin metadata.

Base tables for recording flow centric data.

Later packs extend these core tables with runtime functions, indexes, and mood integration.

10_cin-aux-runtime.sql

Adds runtime oriented elements to cin aux.

Examples:

Additional working tables.

Runtime indexes.

Helper functions for feeding and querying cin aux from jobs.

The exact details are less important than the guarantee that by the end of this pack cin aux can be actively used by jobs and engines.

11_cin-aux-functions.sql

Adds function heavy pieces on top of cin aux core and runtime.

Responsibilities may include:

Computation of derived flow metrics.

Helper procedures for moving data between cin aux and matrices or wallet.

Guarded foreign keys added after base data structures exist.

By the time 11 completes, cin aux becomes a first class citizen in the analytic pipeline.

12_mea_dynamics.sql

Adds indexes and guard rails for the mood engine.

According to the header it expects core mea_dynamics tables to already exist, and focuses on:

Helpful indexes for cycles and symbol mood tables.

Guarded foreign keys applied only when dependent tables exist.

This pack prepares mea_dynamics for production level querying and smokes.

13_ops.sql

Defines the main ops schema structures.

Responsibilities:

Create ops schema if still missing.

Define enums such as ops.side and ops.status.

Create ops.order and ops.fill tables.

Link ops.order to cin_aux.sessions for context when appropriate.

The ops schema after this pack becomes the home for internal orders and fills as well as some higher level operational traces.

14_views-latest.sql

Contains a rich set of views that present latest snapshots of data across schemas.

Highlights:

Helper function str_aux._has_col to safely check for column presence.

Latest vector views from str_aux.

Latest matrices views tied to current windows.

This pack is careful to be safe even when some tables or columns are not yet present, making it robust across partial deployments.

15_admin.sql

Combined admin pack that now covers former roles, grants, security, and helper sections.

Responsibilities:

Create and configure roles such as cp_admin, cp_writer, cp_reader, cp_app, and runtime roles cryptopill_api, cryptopill_jobs, cryptopill_read.

Apply schema usage grants to the appropriate roles.

Apply detailed table and view grants.

Install base row level security policies across key tables.

This pack is the backbone of the permission model and should be kept in sync with the application expectations.

16_ingest.sql

Introduces the modern ingest schema layout.

Design goals listed in the header include:

Universe first, where settings.coin_universe is the source of truth.

Append only raw payload capture for Binance data.

Idempotent writers that normalise outputs into str_aux and related tables.

LISTEN and NOTIFY based hooks so a daemon can react when the universe changes.

This pack connects the conceptual universe to concrete ingestion cursors and raw tables.

17_units.sql

Adds explicit time unit and window reference tables under settings.

Structures:

settings.time_units with basic canonical units.

settings.windows with labels, amount, unit, and computed duration in milliseconds.

settings.parse_window_label helper to map text labels into structured rows.

While settings already held some window information earlier, this pack formalises the reference tables in a reusable and self documenting way.

18_str-aux_support.sql

Support pack for str aux diagnostics.

Key piece:

str_aux.v_stats_coverage view that cross joins enabled symbols with default window labels and counts rows from structural tables to show coverage.

This view powers smokes and debug pages that need a quick overview of how well the sampler is covering the coin universe.

19_debug.sql

Creates the debug schema and a set of safe alias views over market and other schemas.

Responsibilities:

Provide debug._ob_src and similar alias views that map to real tables when present and otherwise expose empty stubs.

Offer coverage and gap analysis helpers for klines and other feeds.

This is intentionally safe to run even if str_aux or some market tables are missing, making it useful in partial or broken deployments.

20_cin_aux_views.sql

Integrates account trades and wallet moves with cin aux.

Highlights:

Creates market.account_trades as a durable store of raw account trades from Binance.

Defines helper functions to import trades into wallet.moves in an idempotent fashion.

This pack closes the loop between external account activity and internal flow interpretation.

ddl.sql.disabled

A legacy aggregator file that once chained all DDL packs together. It is now disabled, kept only for historical context.

The recommended approach is to let the modern tooling iterate numeric DDL files directly rather than rely on this legacy script.

Guarantees of the ordering

By following this order the database ensures that:

Schemas exist before tables and views that target them.

Extensions and enums are available before any dependent types are used.

Settings and market structures exist before ingest and sampling packs link to them.

Security is applied after all core tables and views are created.

Debug and support schemas run last and are safe in partially applied states.

If you introduce new DDL packs they should be slotted into this order with great care, especially if they depend on existing schemas or are responsible for security or operations level changes.