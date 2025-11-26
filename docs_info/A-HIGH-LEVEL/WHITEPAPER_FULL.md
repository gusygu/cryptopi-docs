# PRODUCT_OVERVIEW.md

## CryptoPi / CryptoPill — Product Overview

### Purpose

CryptoPi is a modular, multi‑layer analytical engine designed to observe, evaluate, and contextualize crypto‑market dynamics through structured data ingestion, multi‑scale sampling, auxiliary signal computation, and a unified client interface. Its goal is not to predict markets, but to **frame** them — revealing structural behavior, sentiment patterns, windows of stability/instability, and portfolio‑level traction through a clean and disciplined architecture.

### Core Ideas

* **Modularity**: each domain is isolated into its own schema and logic (settings, market, matrices, str‑aux, cin‑aux, mea‑dynamics, wallet, ops).
* **Sampling Windows**: market data is processed in deterministic windows (1m/5m/30m etc.), ensuring repeatability and comparability.
* **Auxiliary Engines**: signal layers (str‑aux, cin‑aux, mea‑dynamics) transform raw data into interpretable states.
* **Tiers & Weights**: matrices and mood engines establish weightings, momentum snapshots, and behavioral tiers.
* **Simplicity for End‑Users**: the interface exposes only what is essential — clean matrices, wallet tiers, and flows.
* **Traceability**: every run is timestamped and anchored through ops.session_log and hashable document packs.

### What It Is Not

* Not a trading bot.
* Not a speculative signals provider.
* Not an automated wealth optimizer.

CryptoPi is an **observational instrument**, similar in spirit to a astrophysical sensor array: it monitors, organizes, and reveals patterns that otherwise remain invisible.

---

# WHITEPAPER_LIGHT.md

## CryptoPill — Light Whitepaper

### Introduction

CryptoPill is an attempt to reconcile fragmented crypto‑market information into an intelligible, layered structure. It treats markets not as chaotic price lines but as **ecosystems with measurable states**. Each module plays the role of a small observatory, contributing its own lens.

The light version of the whitepaper summarizes these ideas without formal definitions or equations.

### System Philosophy

1. **Ecosystemic View**

   * A market is a living, adaptive mesh of flows, incentives, and perturbations.
   * Instead of assuming predictability, CryptoPill models *response surfaces* — how instruments behave relative to the rest of the universe.

2. **Structural Decomposition**

   * Raw data is ephemeral; structured windows give it shape.
   * Auxiliary modules give it meaning: strength, sentiment, flow, imprint, luggage, stability.

3. **Human‑Readable Outputs**

   * Users are not shown dozens of chart layers — only the most condensed matrices and mood tiers.
   * The emphasis is clarity over quantity.

### Conceptual Pillars

* **Windows as Frames**: every 30m window is a micro‑portrait; the chain of windows forms a narrative.
* **Auxiliary Engines**:

  * `str‑aux`: sampling vectors and strength fields
  * `cin‑aux`: ledger‑style imprint/luggage flows
  * `mea‑dynamics`: mood estimation, tiers, and interpretive summaries
* **Determinism**: windows are reproducible given the same data inputs.
* **Anchoring & Transparency**: timestamps, session UUIDs, and hash‑packs provide auditability.

### User Experience Goals

* Provide a feeling of *interpretive altitude* — seeing the market from above.
* Minimize noise, maximize signal.
* Preserve the ability to drill down without burying the user in complexity.

### Closing

CryptoPill stands on the idea that markets cannot be simplified into a single number but can be explained through layered, harmonized structures. The system is a map — not the territory — but a map that evolves with clarity, precision, and humility.

---

# ARCHITECTURE.md

## System Architecture

### Overview

CryptoPi is structured as a **multi-schema, multi-module analytical system** where each domain operates semi-independently but participates in a unified data flow. The architecture prioritizes determinism, modularity, and structural clarity.

The platform can be mentally modeled as three stacked layers:

1. **Acquisition Layer** – ingestion and windowing
2. **Auxiliary Engines** – computation of structured interpretations
3. **Presentation Layer** – unified client interface (Next.js)

All of this is anchored by a well-defined database schema hierarchy and an operations layer for session stamps and health instrumentation.

---

## Layer 1 — Acquisition

### Market Ingest

* Pulls trades, klines, and tickers from Binance.
* Normalizes them into canonical tables under the `ingest` schema.
* Ensures rate-limiting compliance and window-aligned batching.

### Windowing & Sampling

* The system creates fixed-size windows (e.g. 30m) where all calculations occur.
* Each window is deterministic: given identical ingest data, the resulting window is reproducible.
* Sampling pipeline lives primarily in `str_aux` and `matrices`.

---

## Layer 2 — Auxiliary Engines

### STR-AUX (Structural Auxiliary)

* Computes strength vectors and transformation fields.
* Normalizes symbols to common baselines.
* Maintains sampling quality and ensures windows reach expected density.

### MATRICES

* Converts auxiliary signals into interpretable matrices.
* Handles: pct24h, benchmarks, weight maps, tiers.
* Exposes aggregated views for client UI.

### CIN-AUX

* Ledger of flows: imprint, luggage, accumulation, drainage.
* Computes token-specific traction and local flow signals.
* Useful for interpreting local vs systemic pressures.

### MEA-DYNAMICS

* “Mood” engine: evaluates global traction, stability, and sentiment tiers.
* Harmonizes inputs from STR, CIN, and MATRICES.

---

## Layer 3 — Presentation Layer (Client)

### Next.js 14 App Router

* Clean split between `info`, `modules`, and `auth` segments.
* Server Components for static docs and data-driven views.
* Client Components for interactive wallets, matrices, flows.

### UI Themes

* Structured around a cobalt/graphite palette.
* Emphasizes clarity, minimalism, and interpretive altitude.

---

## Core Database Structure

### Schemas

* `settings` – project configuration, symbol universe, feature gates.
* `market` – canonical, cleaned market data.
* `matrices` – pct windows, aggregated matrices, computed fields.
* `str_aux` – sampling vectors, structural fields.
* `cin_aux` – imprint/luggage ledger.
* `mea_dynamics` – mood/tier computations.
* `ingest` – raw Binance pulls.
* `ops` – sessions, stamps, logs, runtime health.

### DDL Approach

* All schemas defined through ordered files (00 → 17).
* Views are grouped in a late-stage "views-latest" pack.
* Roles + grants + RLS applied after all schema definitions.

---

## Operations Layer

### Session Stamps

* Each boot produces a UUID-bound runtime session.
* Stored in `ops.session_log` and reflected into schema views.
* Provides auditability and consistency.

### Health Monitoring

* "Smokes" run as soft tests after each deploy or boot.
* Each module has its own diagnostic view.

---

## External Integrations

### Binance

* Reads: klines, trades, tickers.
* Respects strict throttling.
* Uses adaptive call schedules to avoid congestion.

### Hash Packs / Registration

* Optional: synchronizing docs into a hash-pack for external timestamping.

---

## Closing Notes

The architecture favors slow, deliberate, observable computation. Rather than chasing microsecond precision or predictive models, CryptoPi builds a **stable interpretive structure** where each module reinforces the clarity of the others.
