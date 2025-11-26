MATRICES_SEMANTICS.md
What Are Matrices?

Matrices are the core computational artifacts that represent short‑range dynamics of each symbol. They standardize pct changes, windows, and benchmark relationships.

Key Elements
1. pct24h

The 24‑hour percentage variation for each symbol. Always pulled, validated, windowed, and stored with timestamps.

Represents the base volatility snapshot.

Feeds directly into mood computations.

2. Benchmarks

Comparative curves used to give context to pct24h.

Typically: BTC, ETH, SOL, or user‑defined.

Used to compute differential strength.

3. Weights

Relative influence of each symbol.

Example: user may weigh majors heavier.

Affects aggregated tiering.

4. Tiers / Classes

Symbols are categorized into classes to simplify UI interpretation.

Primary Tiering: High‑caps, mid‑caps, volatile.

Matrix Tiering: Detects event‑level stress or euphoria.

5. Rolling Windows

Str‑Aux provides short‑window slices.

w3, w12, w48, etc., with min/max/mean.

Capture short‑term microstructures.

6. Derived Fields

GFM (Global Flow Multiplier): Detects synchronized market effects.

id_pct: Identity pct for clean baselines.

How They Interact

Market ingest updates pct24h.

Matrices recompute each symbol's contextual metrics.

Str‑Aux windows provide short‑range micro‑dynamics.

Mea‑Mood uses these values to build global tier.

Cin‑Aux uses matrices to contextualize ledger PnL.