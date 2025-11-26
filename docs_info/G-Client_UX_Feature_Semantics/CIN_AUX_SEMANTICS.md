CIN_AUX_SEMANTICS.md
Overview

Cin-Aux is the ledger and PnL engine. It transforms trades, balances, and matrix context into a coherent representation of imprint, luggage, and realized/unrealized performance.

Core Concepts
1. Imprint

The primary ledger entry for any position-affecting event.

A trade, transfer, or balance correction creates an imprint.

Each imprint stores: symbol, qty, price, timestamp, context.

2. Luggage

Secondary propagation deriving from imprint.

Adjusts downstream effects (avg price, exposure shifts).

Enables consistent multi-event reasoning.

3. PnL Reasoning

Cin-Aux computes:

Realized PnL: based on matched opposing flows.

Unrealized PnL: based on matrices + last-known valuations.

Contextual PnL: includes structural signals (vector deltas).

4. Continuity & Sessions

Session stamps from ops ensure chronological consistency.

5. Views

Aggregated UI-facing projections:

Flow summaries

Exposure lineage

Symbol-level PnL tables

Why It Matters

Cin-Aux provides the stable, normalized accounting layer from which all user-facing financial indicators derive.