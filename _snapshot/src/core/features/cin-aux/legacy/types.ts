export type SessionId = number;
export type Asset = string;

export type ExecMoveArgs = {
  sessionId: SessionId;
  ts: Date;
  from: Asset;
  to: Asset;
  executedUSDT: number;
  feeUSDT?: number;
  slippageUSDT?: number;
  refTargetUSDT?: number | null;
  plannedUSDT?: number | null;
  availableUSDT?: number | null;
  priceFromUSDT?: number | null;
  priceToUSDT?: number | null;
  priceBridgeUSDT?: number | null;
};

export type BalanceRow = {
  asset_id: string;
  opening_principal: string | number;
  opening_profit: string | number;
  principal_usdt: string | number;
  profit_usdt: string | number;
  closing_principal: string | number | null;
  closing_profit: string | number | null;
};

export type MoveRow = {
  move_id: number;
  session_id: number;
  ts: string;
  from_asset: string;
  to_asset: string;
  executed_usdt: string | number;
  fee_usdt: string | number;
  slippage_usdt: string | number;
  ref_usdt_target: string | number | null;
  planned_usdt: string | number | null;
  dev_ref_usdt: string | number | null;
  comp_principal_usdt: string | number;
  comp_profit_usdt: string | number;
  p_bridge_in_usdt: string | number | null;
  p_bridge_out_usdt: string | number | null;
  lot_units_used: string | number | null;
  trace_usdt: string | number;
  profit_consumed_usdt: string | number;
  principal_hit_usdt: string | number;
  to_units_received: string | number | null;
  residual_from_after: string | number | null;
  notes?: string | null;
};

export type RollupRow = {
  session_id: number;
  imprint_principal_churn_usdt: string | number;
  imprint_profit_churn_usdt: string | number;
  imprint_generated_profit_usdt: string | number;
  imprint_trace_sum_usdt: string | number;
  imprint_devref_sum_usdt: string | number;
  luggage_total_principal_usdt: string | number;
  luggage_total_profit_usdt: string | number;
};

export type MoveParamsV2 = {
  sessionId: number;
  ts: Date;
  fromAsset: string;
  toAsset: string;
  executedUSDT: number;
  feeUSDT: number;
  slippageUSDT: number;
  refTargetUSDT?: number | null;
  plannedUSDT?: number | null;
  availableUSDT?: number | null;
  priceFromUSDT?: number | null;
  priceToUSDT?: number | null;
  priceBridgeUSDT?: number | null;
};
