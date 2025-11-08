/**
 * core/features/cin-aux/types.ts
 * Canonical TypeScript types for the CIN-AUX domain.
 */

export type UUID = string; // keep flexible (db uuid)

export interface CinSessionId {
  sessionId: UUID;
}

export interface CinMove {
  moveId: UUID;
  sessionId: UUID;
  ts: string; // ISO
  fromAsset: string;
  toAsset: string;
  executedUsdt: string;   // numeric as string
  feeUsdt: string;
  slippageUsdt: string;
  compPrincipalUsdt: string;
  compProfitUsdt: string;
  traceUsdt: string;
  profitConsumedUsdt: string;
  principalHitUsdt: string;
  devRefUsdt: string;
  pBridgeInUsdt: string;
  pBridgeOutUsdt: string;
  lotUnitsUsed: string;
}

export interface CinSessionRollup {
  sessionId: UUID;
  openingPrincipalUsdt: string;
  openingProfitUsdt: string;
  closingPrincipalUsdt: string;
  closingProfitUsdt: string;
}

export interface ExecuteMoveInput {
  sessionId: UUID;
  ts: string; // ISO
  fromAsset: string;
  toAsset: string;
  units: string;            // units being moved/consumed (base asset units)
  priceUsdt: string;        // execution price in USDT
  feeUsdt?: string;
  slippageUsdt?: string;
  bridgeInUsdt?: string;    // p_bridge_in
  bridgeOutUsdt?: string;   // p_bridge_out
  devRefUsdt?: string;
  refTargetUsdt?: string | null; // optional ref target used by strategy
  note?: string | null;
}

/** Computed client-side helper values */
export interface ImprintLuggage {
  imprintUsdt: number;
  luggageUsdt: number;
  tauNetUsdt: number; // imprint - luggage
}

export interface DbConfig {
  connectionString?: string;
  host?: string;
  port?: number;
  user?: string;
  password?: string;
  database?: string;
  ssl?: boolean;
}