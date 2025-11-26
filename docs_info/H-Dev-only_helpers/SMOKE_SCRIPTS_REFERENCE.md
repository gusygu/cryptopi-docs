SMOKE_SCRIPTS_REFERENCE.md
Purpose

Smoke scripts validate the health of each module without performing full operations.

Key Scripts
1. apply-ddls.mts

Sequentially applies all DDL files in correct order.

Logs failures clearly.

Ensures schema parity.

2. smokes.mts

Runs quick-checks:

Database reachability

Views presence

Matrices sanity

Symbol universe consistency

3. jobs/run-daemon.mts

Pulls market data, updates matrices, windowing, mood, and ledger projections.

4. sequence testers

PowerShell helpers to validate exchange calls with isolated environments.

How To Run
pnpm smokes

Or for direct script: