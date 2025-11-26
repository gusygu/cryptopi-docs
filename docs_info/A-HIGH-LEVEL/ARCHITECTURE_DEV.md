ARCHITECTURE_DEV.md
Developer Architecture Reference
Purpose

This document is the developer-facing deep dive into the internal structure of CryptoPi/CryptoPill. While the user-oriented Architecture summary focuses on conceptual clarity, this version focuses on: schema internals, code flows, job orchestration, caching, rate limits, and module interplay at runtime.

1. High-Level System Map

CryptoPi consists of five mechanical layers tightly integrated:

Client Interface (Next.js 14)

API Layer (Next.js Routes + Internal Services)

Auxiliary Runtime (Jobs, Daemons, Samplers)

Database System (PostgreSQL, multi-schema, strict DDL ordering)

External Providers (Binance, hash registries, optional timestamping)

2. Schemas Breakdown (Developer Detail)

Each schema provides one self-contained functional responsibility:

settings

Controls universe selection (CSR/SSR).

Manages feature flags and toggleable behaviors across modules.

Acts as the root of configuration truth.

market

Canonical normalized market data.

Tables include: prices, rollups, latest_ticker, etc.

Acts as “clean room” data before auxiliary interpretation.

ingest

Temporary but durable ingestion records.

Raw Binance klines + trades.

Ensures replayability of windows.

str_aux

Sampling engine: vectors, norms, structural fields.

Handles density requirements and window stabilization.

matrices

pct24h

baseline benchmark comparisons

calculated tiers and weighting logic

high-level views exposed to UI.

cin_aux

Token-specific flow semantics: imprint, luggage, drainage, accumulation.

Used by both UI and mood engine.

mea_dynamics

Mood engine: computes traction and stability tiers.

Harmonizes signals from matrices + cin_aux + structural vectors.

ops

Session stamps

runtime logs

system-level health indicators

3. Data Flow (Developer-Grade Detail)
Step 1 — Ingestion

Raw Binance → ingest.raw_* tables.

Timestamps aligned.

Step 2 — Market Normalization

Transforms ingest into market.* tables.

Applies deduplication, sanitizing, rewindowing.

Step 3 — Window Sampling

str_aux pulls from market.

Applies sampler rules, computes vectors.

Stores structural fields.

Step 4 — Structural Interpretation

matrices pulls both market + str_aux.

Generates pct24h, baseline deltas, weight tiers.

Step 5 — Semantic Interpretation

cin_aux and mea_dynamics compute:

imprint/luggage flows

mood

global traction

stability tiers.

Step 6 — Presentation Layer

UI reads from stable v_latest_* views.

4. Job System

The job system consists of:

Sampler (30m window jobs)

Market sync daemon

Universe validation job

Each job writes detailed logs into ops.*.

5. Rate Limiting & Throttling

Binance API is handled with:

adaptive throttling

reduced sampling when slow

enforced ceilings per 30m window