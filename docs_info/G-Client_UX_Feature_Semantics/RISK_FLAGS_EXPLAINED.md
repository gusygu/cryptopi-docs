RISK_FLAGS_EXPLAINED.md
Purpose

Risk flags surface conditions that require user attention. They can be structural, behavioral, or data-quality related.

Categories of Flags
1. Data / Ingest Flags

Missing pct24h: Market provider didn't return valid data.

Flow Gaps: Str-Aux windows not continuous.

Symbol Disabled Upstream: CSR/SSR mismatch.

2. Structural Risk Flags

Volatility Spike: pct24h or window deltas breach stress thresholds.

Benchmark Divergence: symbol behaving abnormally vs benchmark.

Global Synchronization: multiple symbols under sudden coordinated move.

3. Ledger Flags

Imprint Gap: expected movement not logged.

Luggage Mismatch: propagation error or imbalance.

PnL Outlier: extreme deviation vs expected range.

4. Session Flags

Failed Exchange Fetch: Binance/route pull issue.

Incomplete Session: open stamp without successful ingest.

UI Presentation

Flags appear in the dashboard and relevant module pages.

Each flag includes: type, severity, cause summary, and recommended action.