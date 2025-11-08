# core/features/cin-aux

CIN-AUX core mechanics for CryptoPill. This module wraps the database ledger
(DDL & functions shipped via `cin-aux-pack.sql`) and exposes a minimal TS API.

## Files

- `types.ts` — domain types for CIN entities
- `db.ts` — pg Pool and transaction helper
- `sql.ts` — parameterized SQL strings
- `repo.ts` — direct DB operations (execute move, query views)
- `service.ts` — imprint/luggage helpers, high-level flows
- `index.ts` — public exports

## Usage

```ts
import { applyMoveAndHydrate, getTauSeries } from "core/features/cin-aux";
// Set DATABASE_URL or PG* env vars

const res = await applyMoveAndHydrate({
  sessionId: "d2b48fa1-7d9f-4f0e-9c2b-3b8a36b68777",
  ts: new Date().toISOString(),
  fromAsset: "BTC",
  toAsset: "USDT",
  units: "0.005",
  priceUsdt: "68000",
  feeUsdt: "2.1",
  slippageUsdt: "0.9",
  bridgeInUsdt: "0",
  bridgeOutUsdt: "0",
  devRefUsdt: "0",
  refTargetUsdt: null,
  note: "test exec",
});

console.log(res.latest, res.tau, res.rollup);
```

## Assumptions

- The database already has the **CIN-AUX pack** applied:
  - schema `strategy_aux`
  - functions: `cin_exec_move_v2(...)` et al.
  - views: `v_cin_move_attrib`, `v_cin_session_rollup`

Adjust `computeImprintLuggage` once the formal definition is finalized.