MODULES_OVERVIEW.md
Overview of System Modules

CryptoPi is composed of multiple modules, each with a precise responsibility and tightly bounded semantic domain. Understanding these modules as independent observatories helps developers and users see how different layers of meaning are constructed.

This document presents a panoramic overview of every module, its schema, its role, and how it communicates with the rest of the system.

1. SETTINGS MODULE

Schema: settings

Purpose

Defines the core configuration of the entire system.

Responsibilities

Universe definition (CSR/SSR)

Feature flags and gating

Global parameters for samplers, windows, and auxiliary engines

Why it matters

It is the root of truth for how the system behaves. All other modules consult settings before performing computation.

2. MARKET MODULE

Schema: market

Purpose

Holds normalized, validated, and deduplicated market data.

Responsibilities

Canonical prices and tickers

Market-wide rollups

Latest values used by matrices & engines

Why it matters

It provides the clean structured data that every computational module depends on.

3. INGEST MODULE

Schema: ingest

Purpose

Captures raw exchange data as delivered.

Responsibilities

Raw Binance klines, trades, depth

Timestamp normalization

Integrity & replayability

Why it matters

It enables deterministic reprocessing of windows by keeping raw data intact.

4. STR-AUX MODULE

Schema: str_aux

Purpose

Transforms market data into structural vectors and fields.

Responsibilities

Window sampling at strict intervals

Vector normalization across symbols

Strength fields and structural metrics

Why it matters

Acts as the foundational analytic engine upon which matrices and mood rely.

5. MATRICES MODULE

Schema: matrices

Purpose

Creates interpretable, aggregated matrix data from lower-level structures.

Responsibilities

pct24h calculations

Benchmarks vs baseline assets

Tiers, weight maps, and signals

Why it matters

It is the primary layer exposed to users in the UI.

6. CIN-AUX MODULE

Schema: cin_aux

Purpose

Interprets flows within assets: imprint, luggage, drainage, accumulation.

Responsibilities

Ledger-style flow recording

Directionality and pressure detection

Used by mood + extended matrices

Why it matters

It explains why symbols behave as they do, revealing hidden structural pressures.

7. MEA-DYNAMICS MODULE

Schema: mea_dynamics

Purpose

Computes the mood of the system.

Responsibilities

Traction estimations

Stability index

Multi-layer harmonization from matrices + cin_aux

Why it matters

It distills the complex flows of markets into clear psychological tiers.

8. WALLET MODULE

Schema: wallet

Purpose

Provides user-specific portfolio tracking.

Responsibilities

Wallet value snapshots

Tier assignment per asset

Behavioral fingerprints

Why it matters

It grounds market interpretation in personal context.

9. OPS MODULE

Schema: ops

Purpose

Provides meta-infrastructure: session tracking, diagnostics, and operational metadata.

Responsibilities

Session stamps (UUID-bound)

Health metrics

Smokes diagnostics

Why it matters

It ensures the entire system is inspectable, auditable, and testable