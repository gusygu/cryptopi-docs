JOBS_AND_DAEMONS.md
Jobs & Daemons — Runtime Orchestration

CryptoPi depends on a collection of background jobs and daemons that work together to maintain a stable, continuous, interpretable flow of information. These processes ensure that ingestion, sampling, synchronization, and universe validation occur smoothly and in harmony with real-time market behavior.

This document details each runtime component, its responsibilities, triggering conditions, invariants, and how it interacts with PostgreSQL and other modules.

1. Overview

CryptoPi uses three primary classes of long-running processes:

Market Synchronization Daemons — keep ingest and market layers fresh.

Sampling & Window Jobs — compute 30m (and other) structural windows.

Universe & Health Jobs — enforce configuration integrity and detect systemic issues.

These components run independently but follow a shared design philosophy: predictability, determinism, and low variance.

2. Market Sync Daemon
Purpose

Continuously fetch and store raw market data from Binance.

Responsibilities

Pull klines and trades in a controlled, rate-limited loop.

Populate ingest.* tables.

Signal backpressure when Binance slows.

Behavioural Notes

If Binance rate-limit thresholds rise, the daemon backs off and re-queues work.

If gaps are detected, it triggers a corrective fetch.

Writes detailed logs in ops.market_sync_log (future optional table).

Guarantees

No dropped segments unless upstream fails.

Deterministic reconstruction of ingest history.

3. Window Sampling Job
Purpose

Compute deterministic sampling windows (e.g. 30m) at precise intervals.

Responsibilities

Trigger window creation at predictable schedules.

Use ingest + market to derive input vectors.

Store normalized strength vectors in str_aux.

Trigger downstream computation in matrices and mea_dynamics.

Invariants

A window must either fully compute or not compute at all.

Windows are immutable once produced.

Dependencies (market, ingest) must be complete before sampling.

Notes

The sampler is the heart of the system’s temporal structure. If the sampler is misaligned, everything above it becomes unreliable.

4. Matrix Aggregation Job (Optional Future Separation)
Purpose

Transform structural vectors into high-level matrices.

Responsibilities

Compute pct24h

Update baseline comparisons

Assign weight tiers

Refresh latest views

Notes

Currently matrices are computed synchronously with sampling but may split into an independent job for scalability.

5. Universe Validation Job
Purpose

Ensure the system’s configured universe (CSR/SSR) matches actual enabled symbols and downstream operational expectations.

Responsibilities

Compare settings.universe with real ingest availability.

Automatically enable/disable symbols when consistent.

Detect symbol drift or missing data.

Invariants

No window should compute a symbol that is “disabled”.

No symbol should be enabled if ingest cannot support it.

6. Mood Engine Refresh Job
Purpose

Maintain up-to-date global mood and stability tiers.

Responsibilities

Harmonize signals from structural + matrices + flows.

Keep tier levels consistent across windows.

Precompute any expensive mood subcomponents.

When triggered

After each window computation

When significant symbol universe changes occur

7. Health & Diagnostics Daemons
Purpose

Give real-time visibility into systemic health.

Responsibilities

Track smokes

Scan for abnormal window gaps

Validate that ingest is advancing predictably

Track session integrity

Outputs

Populates ops.session_log

Generates smokes packs for the UI

8. Scheduling & Coordination

CryptoPi adheres to a staggered scheduling model:

Market sync runs frequently (seconds to minutes)

Sampler triggers at aligned intervals (e.g. every 30m)

Aggregations follow immediately after sampling

Mood engine refreshes once aggregated signals stabilize

Health scans run opportunistically between jobs

This avoids compute spikes and ensures the system remains responsive.

9. Failure Modes & Recovery
Market Sync Down

System pauses sampling

UI surfaces partial data indicators

Sampling Failure

Window marked as failed

Automatically retried

No half-computed window reaches matrices

Mood Engine Error

Fallback to last stable state

DB or Network Latency

Jobs throttle

Sampler backs off

Repair attempts queued

10. Closing

The orchestrated work of jobs and daemons is what makes CryptoPi a living system. Without them, matrices and mood would not evolve reliably.

Their philosophy is simple:

Never rush. Never skip. Never compute partially. Always be deterministic.