DATA_FLOWS.md
System Data Flows

This document details how information moves through the system — from raw market events to high-level interpretive structures shown in the client UI. Understanding these flows is essential for debugging, optimizing, and extending the system.

1. Global Flow Overview

There are six major flows happening at all times:

Ingestion Flow – Raw exchange data enters the system.

Normalization Flow – Raw data becomes structured and validated.

Sampling Flow – Window-based computations form structural vectors.

Aggregation Flow – Vectors become matrices and signals.

Semantic Flow – Matrices + flows → mood, traction, and stability.

Presentation Flow – Interpretable UI surfaces for the user.

Each flow enriches the previous one.

2. Ingestion Flow
Source → System

Raw Binance data is pulled into ingest.

Guarantees

No mutation

Full replayability

Timestamps preserved

Output

A chronological, canonical record of all raw events.

3. Normalization Flow
ingest → market

Data is sanitized, deduplicated, and aligned:

Clean timestamps

Validate missing segments

Apply correction if needed

Output

A pristine layer of data under market used as the base for all structural computation.

4. Sampling Flow
market → str_aux

The sampler generates deterministic vectors:

Window slicing

Vector generation

Strength normalization

Determinism

Every window must be reproducible if ingest remains the same.

5. Aggregation Flow
str_aux → matrices

Matrices compute high-level interpretive surfaces:

pct24h

cross-asset comparisons

benchmark deltas

weight tiers

Output

Consistent v_latest_* views.

6. Semantic Flow
matrices + cin_aux → mea_dynamics

Here meaning is added:

Mood estimation

Stability scoring

Traction signals

Output

Interpretive tiers displayed to the user.

7. Presentation Flow
mea_dynamics & matrices → client UI

The app shows:

Key matrices

Mood tiers

Wallet grades

Diagnostic flows

Principles

No noise

No raw data unless necessary

Only interpreted structures reach the user

8. Closing Notes

All flows form a layered pipeline:

Raw → Clean → Structured → Aggregated → Interpreted → Presented

Every module contributes meaning to the layer above it.