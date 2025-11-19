// src/lib/dynamics.contracts.ts
// Single source of truth for Dynamics types (contracts).

import type { MatrixKey, MatrixGrid, MatricesResponse } from "@/core/matrices/types";

export type Coin = string;
export type Coins = string[];
export type Grid = MatrixGrid;

export type TsKey = MatrixKey;

export type MatricesPayload = MatricesResponse;

export type MooResp = { ok: boolean; grid?: Grid };

export type PreviewResp = { ok: boolean; symbols?: string[] };

export type StrBinsResp = {
  ok: boolean;
  ts: number;
  out: Record<
    string,
    {
      ok: boolean;
      gfmDelta?: { absPct?: number };
      shifts?: { nShifts: number; timelapseSec: number; latestTs: number };
      swaps?: number;
      fm?: { vInner?: number; vOuter?: number };
      lastUpdateTs?: number;
    }
  >;
};

export type Pair = { base: string; quote: string };

export type PairMarket = {
  benchmark: number;
  id_pct: number;
  bridge: {
    bm: { ca_usdt: number; usdt_cb: number };
    id: { ca_usdt: number; usdt_cb: number };
  };
};

export type StrAuxMetrics = {
  gfmAbsPct: number;
  vTendency: number; // vInner - vOuter
  shifts: number;
  swaps: number;
  ts: number | null;
};
