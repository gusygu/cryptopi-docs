DATABASE.md
Database Overview

The CryptoPi database is a multi schema PostgreSQL layout designed for clarity, reproducibility, and safe evolution. Rather than one monolithic schema, each conceptual domain lives in its own namespace with strictly ordered DDL files.

The goals are:

Strong separation of concerns between ingestion, market normalisation, structural engines, mood, wallet, and operations.

Idempotent DDL packs that can be re applied without destroying data.

Deterministic sampling windows and reproducible computations.

A clear security model based on roles, grants, and row level security.

All core DDL files live under db/ddl and are applied in numeric order by the tooling in db/cli and db/migrate.

Schemas
util schema

Helper space for shared functions, types, and utilities that do not belong to a specific business domain.

Typical contents:

Small helper functions used by several schemas.

Cross cutting types that would be awkward to repeat.

The util schema should stay thin and focused on low level helpers only.

settings schema

The configuration brain of the system.

Key ideas:

One single source of truth for which symbols exist and which are enabled.

Canonical definitions for windows, units, and poller behaviour.

A small number of key value settings that can evolve over time.

Core structures include:

settings.app_settings key value settings stored as jsonb with updated at stamps.

settings.coin_universe definition of symbols, base asset, quote asset, and enabled flag.

settings.time_units reference units such as millisecond, second, minute, hour, day.

settings.windows window labels such as 30m or 4h with computed duration in milliseconds.

settings.poller_state last seen timestamps and state for pollers.

Everything that wants to know what the universe is or how long a window lasts must consult settings first.

market schema

The canonical cleaned market data layer.

Typical structures:

market.symbols base and quote asset meta data for each symbol.

market.klines and related candle tables.

market.ticker_ticks and market.ticker_latest for fast latest price reads.

market.orderbook_snapshots for depth based diagnostics.

market.account_trades for raw account trade history feeds.

The market schema sits between ingest and the analytic engines. It guarantees that data is deduplicated, normalised, and indexed appropriately.

docs schema

The documentation and registration companion schema.

Possible responsibilities:

Storing structured document packs and their hashes.

Tracking which VERSION and SOURCE_TAG a given database state is meant to correspond to.

Keeping trace of external registrations or anchoring events.

This schema allows the database to carry some self describing documentation meta data alongside the code repo doc packs.

wallet schema

The portfolio and account interpretation layer.

Key concepts:

wallet.moves atomic value moves representing trades, deposits, withdrawals, transfers.

wallet.accounts and related entities for grouping moves per user or logical wallet.

wallet.snapshots aggregated views of wallet state at a point in time.

The wallet module does not invent its own prices. It reads market and matrices, applying those valuations to moves to obtain value paths and tiers.

matrices schema

The primary matrix engine that turns raw and structural inputs into higher level series.

Core tables include:

matrices.series catalogue of logical series by key, name, scope, and unit.

matrices.points time based points belonging to series.

matrices.points_latest view that rolls series into the latest point per series.

From here, specialised matrices such as pct returns, benchmark deltas, and composite tiers are built and exposed through views. Matrices are the first heavily user facing layer in the database.

str_aux schema

The structural auxiliary engine.

Highlights:

Sampling windows anchored by window label and symbol.

Functions that map human friendly labels such as 30m or 4h into precise durations.

Window vectors and related tables that hold structural measurements for each window and symbol.

Internal helper functions to ensure density and coverage.

The str aux schema is fed by market and feeds matrices and mood. It must be stable, deterministic, and deterministic in its behaviour.

cin_aux schema

The cinematic or flow oriented auxiliary engine.

Key roles:

cin_aux.sessions control plane sessions for analytic runs.

Tables for flow trajectories and signal snapshots.

Support for imprint and luggage style interpretations of flows.

cin_aux often bridges between raw trades, wallet moves, and the mood engine, giving a structural view of how volumes and directions behave over time.

mea and mea_dynamics schemas

These schemas represent the mood and interpretive layer.

The mea schema is reserved for legacy or transitional structures. The newer mood engine uses mea_dynamics for production data.

Highlights in mea_dynamics include:

cycles runtime cycles with window label and engine cycle indexing.

mea_symbol and related tables that hold symbol specific mood and stability metrics.

dynamics_snapshot tables and views that offer a high level snapshot for the UI.

These tables are heavily indexed for quick reads by the client and by smokes.

ingest schema

The ingestion buffer layer.

Responsibilities:

Raw klines and trades exactly as received from Binance.

Cursor tables such as ingest.klines_cursor that track how far a given symbol and window have been fetched.

Optional helper functions to push normalised outputs into str_aux.

Ingest is append only and never retrofits data. Corrections are applied in the market schema instead.

strategy_aux schema

Reserved and legacy space for strategy oriented helpers.

At present this schema may be lightly populated or used as an experimental ground for strategy aux views and functions. The core system does not depend on it, so it can evolve quickly without affecting sampling and mood.

ops schema

The operational backbone of the system.

Contents include:

Enum types such as ops.side and ops.status for orders.

ops.order and ops.fill for internal or paper orders.

Session and logging infrastructure providing session wide traces.

Support objects for smokes and diagnostic flows.

Ops is also the home of the opening stamp idea, where each runtime session is bound to a UUID and anchored in time, with per schema reflections.

ext schema

The extension sandbox.

This schema tends to hold wrappers around PostgreSQL extensions and third party functionality. It is a safe place to introduce experimental extension driven features without polluting core schemas.

debug schema

Introduced in later DDLs, the debug schema is a toolkit for live diagnostics.

Examples:

Safe alias views over market or ingest tables that may or may not be present.

Coverage and gap analysis views that let smokes and developers see missing data quickly.

It is safe to keep debug enabled in development and staging. In production it can be selectively queried by smokes and admin tools.

Naming conventions

Across schemas the database follows a few simple conventions:

Primary keys are usually uuid or bigint depending on the table role.

Timestamps use timestamptz and default to now where sensible.

Composite keys are used when natural identity is clear, such as symbol plus time.

Helper functions use a sp prefix when they behave like stored procedures that perform multi step logic.

Views that represent latest snapshots often include latest in their name.

This consistency reduces mental load when moving between modules.

Idempotence and evolution

All DDL files are written to be idempotent whenever possible. That means:

Tables are created with create table if not exists.

Extensions and enums are created inside guarded blocks that ignore duplicates.

Views are recreated through create or replace.

When a structural change cannot be idempotent, it is handled through a dedicated migration rather than in the core DDL pack.

The separate document DDL_ORDER.md explains how these packs are applied and what each stage guarantees.