TESTING.md
Testing Philosophy

Testing combines unit-level validation and integration smoke checks.

Unit Tests

Focus on pure logic (e.g., matrix transforms)

Use fast runs

Integration Tests

Database-connected runs

Validate materialized views, DDL correctness

Ensure ops sessions operate end-to-end

Future Plans

Str-Aux structural tests

Mea-Mood tiering consistency tests

Scenario-based ledger tests