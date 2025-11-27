// cinAuxContracts.ts
// Shared TypeScript contracts for cin-aux runtime, moo alignment, and matrices.
// Adjust numeric/string representations as needed to match your DB client.
// All monetary values are represented as strings here to avoid precision issues.

export type CinRuntimeStatus = "balanced" | "drifted" | "broken";

export interface CinRuntimeSessionSummary {
  sessionId: number;                 // BIGINT rt_session.session_id
  windowLabel: string;
  startedAt: string;                 // ISO timestamp
  endedAt: string | null;
  closed: boolean;

  // Imprint / luggage aggregates (cin_aux.rt_imprint_luggage)
  imprintPrincipalChurnUsdt: string;
  imprintProfitChurnUsdt: string;
  imprintGeneratedProfitUsdt: string;
  imprintTraceSumUsdt: string;
  imprintDevrefSumUsdt: string;
  luggageTotalPrincipalUsdt: string;
  luggageTotalProfitUsdt: string;

  // Reconciliation vs reference (e.g. Binance)
  cinTotalMtmUsdt: string | null;
  refTotalUsdt: string | null;
  deltaUsdt: string | null;
  deltaRatio: string | null;

  status: CinRuntimeStatus;
}

export interface CinRuntimeAssetPnl {
  sessionId: number;
  assetId: string;                   // e.g. BTC, ETH, BNB...

  openingPrincipal: string;
  openingProfit: string;

  principalUsdt: string;             // current principal in USDT
  profitUsdt: string;                // current profit in USDT

  lastMarkTs: string | null;
  priceUsdt: string | null;
  bulkUsdt: string;                  // total mark value from rt_mark

  mtmValueUsdt: string;              // principalUsdt + profitUsdt at last mark

  weightInPortfolio: number | null;  // optional, normalized by total mtm
  realizedPnlUsdt: string | null;    // optional: realized PnL portion

  inUniverse?: boolean;
  referenceUsdt?: string | null;
  accountUnits?: number | null;
}

export interface CinRuntimeMoveRow {
  moveId: number;
  sessionId: number;
  ts: string;                        // ISO timestamp

  fromAsset: string;
  toAsset: string;
  srcSymbol?: string | null;
  srcTradeId?: string | null;
  srcSide?: string | null;

  executedUsdt: string;
  feeUsdt: string;
  slippageUsdt: string;

  refUsdtTarget: string | null;
  plannedUsdt: string | null;
  devRefUsdt: string | null;

  compPrincipalUsdt: string;
  compProfitUsdt: string;

  pBridgeInUsdt: string | null;
  pBridgeOutUsdt: string | null;

  lotUnitsUsed: string | null;
  fromUnits: string | null;

  traceUsdt: string;
  profitConsumedUsdt: string;
  principalHitUsdt: string;

  toUnitsReceived: string | null;
  residualFromAfter: string | null;

  notes: string | null;

  pnlForMoveUsdt: string | null;     // derived per move PnL if you expose it
  feeRate: string | null;            // optional: fee / executed
  effectivePriceFrom: string | null; // optional: executed / units
}

export interface CinAssetTauRow {
  sessionId: number;
  assetId: string;
  imprintUsdt: string;
  luggageUsdt: string;
}

export interface CinRuntimeMarkPoint {
  ts: string;             // ISO timestamp
  priceUsdt: string | null;
  bulkUsdt: string;
}

export interface CinMeaResultRow {
  sessionUuid: string;    // cin_aux.sessions.session_id (uuid, control-plane)
  symbol: string;

  meaValue: number;       // scalar from mea_result.value
  components: any;        // tiers, mood, bulk_per_coin, etc. (jsonb parsed)

  actualLuggageUsdt: number | null;
  actualWeight: number | null;

  suggestedWeight: number | null;
  weightDelta: number | null;        // actualWeight - suggestedWeight
  luggageScore: number | null;       // any composite metric you define
}

export interface CinMatRegistryEntry {
  matId: string;          // uuid
  sessionId: string;      // uuid
  name: string;           // matrix name (e.g. 'pnl_histogram')
  symbol: string;         // e.g. 'BTCUSDT'
  windowLabel: string;
  bins: number;
  meta: any;
  createdAt: string;      // ISO timestamp
}

export interface CinMatCell {
  matId: string;
  i: number;
  j: number;
  v: number;
}
export interface CinMooAlignmentChartPoint {
  symbol: string;
  suggestedWeight: number;
  actualWeight: number;
  weightDelta: number;
}
