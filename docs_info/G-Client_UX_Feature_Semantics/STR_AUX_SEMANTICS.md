STR_AUX_SEMANTICS.md
Purpose

Str-Aux defines the system’s short-range structural sampling. It transforms raw market feed into windowed vectors, ensuring every symbol has a standardized microstructure.

Core Concepts
1. Sampling

The system continuously records pct changes and timestamps from ingest.

Each sample is atomic.

Sampling frequency is uniform per symbol.

Used to build windows.

2. Windows

Windows are slices of recent samples.

w3: last 3 samples

w12: last 12 samples

w48: last 48 samples

Each one stores:

min

max

mean

delta

slope

3. Vectors

Vectors are structured representations that combine multiple windows.

A vector = {w3, w12, w48, timestamp}

Used as a minimal stable reference for downstream modules.

4. Flow Gaps

Str-Aux exposes missing-window states.

Occur when data is not continuous.

UI flags exist to warn user.

Why It Matters

Str-Aux acts as the “micro‑engine” behind mood and matrix tiers. Everything downstream assumes windows and vectors are clean.