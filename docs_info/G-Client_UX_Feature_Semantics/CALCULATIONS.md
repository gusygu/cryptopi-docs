# Client UX Calculation Reference

The client UI is opinionated: every widget renders pre-computed values and never invents its own math. This note consolidates the formulas and thresholds used across Matrices, Dynamics, STR-AUX, Moo/MEA, and Cin-Aux surfaces so design, engineering, and QA share a single source of truth.

## Matrices ( `/matrices`, `/dynamics` )

**Universe + cadence**
- `src/core/settings/matrices.ts` loads the bases and quote either from `MATRICES_BASES/MATRICES_QUOTE` or from `settings.coin_universe`, refreshing every `periodMs = 60_000`.
- Price books come from `src/core/features/matrices/liveFromSources.ts`: only tradable `USDT` pairs survive the Binance queries, and pct24h per pair is derived as `((1+rb)/(1+rq)) - 1`.

**DB + live fusion** - `src/core/maths/math.ts`

```ts
id_pct  = (bm_now - bm_prev) / bm_prev
pct_drv = id_pct_now - id_pct_prev
pct_ref = (bm_now - bm_open) / bm_open
ref     = (1 + id_pct_now) * pct_ref
delta   = bm_now - bm_open * (1 + ref)
```

The API injects `getPrev` and `fetchOpeningGrid` providers so `computeFromDbAndLive` can fill the five grids per cycle; `composeMatrices` then attaches the live benchmark (`bm_now`) and pct24h delta supplied by Binance. Frozen flags arrive through `MatrixFlags` and are converted into purple cell/symbol rings if either the symbol or the specific pair is marked `frozen`.

**Coloring + rings** - `src/core/features/matrices/matrices.ts`, `src/components/features/matrices/colors.ts`
- Shade bins for all pct-based cells use `PCT_BINS = [0.001, 0.0025, 0.005, 0.01, 0.02, 0.04, 0.08, 0.16]`.
- UI cells map to `COLOR_POSITIVE_SHADES` / `COLOR_NEGATIVE_SHADES`; magnitudes `< zeroFloor (0.0005)` render amber; frozen cells use `COLOR_FROZEN` or the stage-specific gradient from `FROZEN_STAGE_COLORS`.
- Pair rings encode derivation: direct => green, inverse => red, bridged => grey, with purple overrides for frozen. Symbol rings use the presence of a direct `SYM/USDT` leg to keep preview consistency.

**Dynamics matrix view** - `src/components/features/dynamics/DynamicsMatrix.tsx`
- Value colors use tighter bins: `|v| < 0.00025 ... 0.016` map into 8 shades per polarity.
- Ring hints: both directions in preview => emerald ring, only inverse leg available => rose ring, otherwise slate. Selection adds a sky outline so users can track the active pair used in detail panels.

## STR-AUX dashboard ( `/str-aux` )

**Sampling pipeline**
- `str_aux.samples_5s` ingests 5 s vectors, `cycles_40s` aggregates them, and `windows` roll aligned intervals. `/api/str-aux/vectors` and `/api/str-aux/stats` expose the latest rows per symbol/window (`src/app/str-aux/StrAuxComponent.tsx`).
- `computeSampledMetricsForSymbol` (`src/core/features/str-aux/calc/executive.ts`) fetches the sampler snapshot, runs `computeStats`, and emits histograms + extrema. Histogram bins default to the client-provided `bins` (256 in the dashboard).

**Vector + session metrics**
- `executeCalcAndUpdateSession` builds ring buffers per pair, extracts `vInner`, `vOuter`, and `vTendency` from the last 60 returns, and computes inertia from the same slice. It also updates gfm sessions so dashboard cards can show `gfmAbs`, delta %, and opening references.
- Panel cards compute `pct_drv = 100 * ((cur / prev) - 1)` inside `buildCards` (`src/core/features/str-aux/calc/panel.ts`) to match the matrices drift semantics.

**Metric formulas** - `src/core/features/str-aux/calc/metrics.ts`

```
inertia.static  = tanh(beta_s * 1/(1+spreadD)) * tanh(beta_m * tau0/|median|)
inertia.growth  = tanh(beta_g * |median| / (spreadD+1e-9))
disruption      = 100 * tanh(gamma * |r_now - median| / spreadD)
amp             = 100 * tanh(etaA * swing/S) * tanh(etaF * flipRate)
volt            = 100 * tanh(lambda * mean(|delta| / spread))
infl/def level  = clamp(S * tanh(kappa * log(L_now / M_now)), -S, S)
artificiality   = 100 * clamp(wM*M + wE*E + wH*HHI, 0, 1)
efficiency      = clamp(S * tanh(alpha * (wT*trend - wV*volt - wA*art)), -S, S)
```

The dashboard surfaces the raw numbers coming back from the stats API (no renormalization on the client). Streams tables simply compare `prev`, `cur`, and `greatest` fields as delivered by `/api/str-aux/stats`.

**Histograms**
- `Stats.histogram` already embeds densities; if a sampler fails to provide one, `computeSampledMetricsForSymbol` falls back to log-return histograms built from the raw points so the UI always has meaningful bars and nuclei highlights.

## Moo-Aux + MEA allocation ( `/moo`, Moo alignment panel inside `/cin` )

**Tier weights** - `src/core/features/moo-aux/tiers.ts`
- `DEFAULT_TIER_RULES` (Alpha..Epsilon) map absolute `id_pct` magnitudes to bin weights: Alpha >=0.00016, Beta >=0.00033, Gamma >=0.00046, Delta >=0.00077, Epsilon >=0.00121.
- `getTierWeighting(id_pct)` returns the rule weight; `pickTierName` exposes the bin name so the UI pair detail shows the tier label next to allocations.

**Mood coefficient** - `src/core/features/moo-aux/mood-formula.ts`, `measures.ts`
- `assembleMoodInputs` pulls `GFMdelta`, `vSwap`, `Inertia`, `Disruption`, `Amp`, `Volt`, and the global `id_pct`.
- `computeMoodCoeffV1` clamps inputs and evaluates `coeff = clamp((vTendency / GFM) + vSwap, 0.2, 2.0)` while also emitting bucket indices (6-way up/down for `vTendency` and `vSwap`, 4-way up/down for `GFM`). `buildMeaAux` multiplies every allocation by this `mood` term.

**Allocation grid** - `src/core/features/moo-aux/grid.ts`, `src/components/features/moo-aux/MooAuxCard.tsx`

```
effectiveK = payload.k ?? max(1, coins.length - 1)
weight(base, quote) = balance_base * (1 / effectiveK) * tierWeight(id_pct) * moodCoeff
```

- Balances are sanitized into `balances[BASE]` so allocations scale with holdings.
- Per-cell detail text includes the MEA uuid (if provided by `/api/moo-aux`), tier weight, and total allocation. Background opacity depends on `|weight| / maxAbsWeight` and hue indicates sign (blue for positive, orange for negative).
- Auto-refresh defaults to `max(15 s, autoRefreshMs)` and the footer shows the actual `k` divisor plus input data sources for traceability.

## Cin-Aux runtime ( `/cin` )

**Ledger math** - `src/core/features/cin-aux/service.ts`
- `imprint = compProfitUsdt - profitConsumedUsdt`
- `luggage = feeUsdt + slippageUsdt + traceUsdt + principalHitUsdt`
- `tauNet = imprint - luggage`
- `applyMoveAndHydrate` persists a move, rehydrates the session, and recomputes tau so `/api/cin-aux/runtime/sessions/.../tau` always reflects the latest ledger.

**Runtime UI** - `src/components/features/cin-aux/CinAuxClient.tsx`
- Session board highlights balanced/drifted/broken status based on `session.status`.
- Summary cards compute `deltaUsdt = cinTotal - refTotal` (server supplies overrides), `deltaRatio = deltaUsdt / refTotal`, and color-code ratios by magnitude (<0.5% green, <2% amber, else rose).
- Asset tiles show MTM, weight, reference, and wallet units; PnL percentages use `profit / total` with `formatPercent`.
- Move tables sum `pnl`, `imprint`, and `luggage` columns client-side for the totals row (mirrors `getMovePnl`, `getMoveImprint`, `getMoveLuggage` helpers).
- `CinButtons` encapsulates the workflows: trade sync -> wallet ingest -> wallet refresh -> price refresh. Auto-sync runs every 8 s while enabled. `RATE_LIMIT_COOLDOWN_MS` (default 60 s, configurable via `NEXT_PUBLIC_CIN_RATE_LIMIT_COOLDOWN_MS`) guards Binance weight errors and disables auto-sync until cool-down expires.

## Quick reference of endpoints and payloads

| Component | Endpoint(s) | Payload highlights |
| --- | --- | --- |
| Matrices card | `/api/matrices/latest`, `/api/matrices/commit` | `coins`, `grids` (`benchmark`, `id_pct`, `pct_drv`, `pct_ref`, `ref`, `delta`), `flags` (frozen) |
| Dynamics matrix | `/api/dynamics` | Same grids as matrices plus MEA overlays; UI reuses `MatrixGrid` contracts from `src/lib/dynamics.contracts.ts`. |
| STR-AUX dashboard | `/api/str-aux/vectors`, `/api/str-aux/stats` | Vector payload contains `vInner`, `vOuter`, `vSwap`, tendency metrics, and histogram nuclei; stats payload exposes cards, streams, extrema, and sampler metadata. |
| Moo-Aux | `/api/moo-aux` | `{ coins, grid, id_pct, balances, k, mood.perSymbol }` - all sanitized before rendering. |
| Cin runtime | `/api/cin-aux/runtime/sessions/*` | Sessions list, balances (`assets`), moves, tau, wallet ingestion status, and Moo alignment session UUID. |

When extending a component, wire new calculations into the same service layer so the UI remains a pure renderer. Every formula above is backed by TypeScript or SQL helpers in the repo; consult the referenced files to modify behaviour instead of duplicating logic in React.
