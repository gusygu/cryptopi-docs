export type Num = number;

export type CoinId = string;

export interface CoinSnapshot {
  id: CoinId;
  // instantaneous id_pct (price delta %) vs previous sampling window
  idPct: Num;              // e.g., +1.25 => +1.25%
  // normalized baseline id_pct for the coin (volatility norm)
  idPctBaseline: Num;      // e.g., 0.80 (%)
  // available bulk in base currency units for this coin
  bulk: Num;               // e.g., 1250.00
}

export interface UniverseSnapshot {
  coins: CoinSnapshot[];
  // total number of coins participating (dupe of coins.length but explicit)
  nCoins?: number;
}

export interface TierBand {
  name: string;
  // threshold is on |z| = |(idPct - baseline)/max(baseline, eps)|
  zMin: Num; // inclusive
  zMax: Num; // exclusive (use +Infinity for top band)
  weight: Num;
}

export interface TierConfig {
  bands: TierBand[];
  // epsilon to stabilize division
  eps?: Num; // default 1e-9
}

export type MoodMagnitude = "weak" | "moderate" | "strong";
export type TrendDir = "up" | "down";
export type FlowSign = "+" | "-";

export interface MoodInput {
  gfmDeltaPct: Num;  // Global Flow Momentum (delta %)
  vSwap: Num;        // velocity of swap volume (signed)
  vTendency: Num;    // trend slope proxy (signed)
}

export interface MoodKey {
  gfmSign: FlowSign;
  gfmMag: MoodMagnitude;
  vSwapDir: TrendDir;
  vSwapMag: MoodMagnitude;
  vTendencyDir: TrendDir;
  vTendencyMag: MoodMagnitude;
}

export interface MoodConfig {
  // thresholds for magnitude bucketing (abs(value) in % points or slope units)
  weakMax: Num;      // abs(x) <= weakMax => "weak"
  moderateMax: Num;  // abs(x) <= moderateMax => "moderate"; else "strong"
  // default coefficient when no exact key match (fallback)
  defaultCoeff: Num; // e.g., 1.0
  // lookup table (192-ish combos); missing entries fall back to heuristics
  table?: Partial<Record<string, Num>>;
  // clamp range for mood coefficient
  clampMin?: Num; // default 0.2
  clampMax?: Num; // default 2.0
}

export interface MeaConfig {
  tiers: TierConfig;
  mood: MoodConfig;
  // global clamps/sanitization
  clampMinAllocation?: Num; // default 0
  clampMaxAllocation?: Num; // default +Infinity
  // how to emit the matrix
  matrixMode?: "vector" | "diagonal" | "outer";
  // optional per-coin cap multiplier (e.g. to cap aggressive coins)
  perCoinCap?: Num; // e.g., 2.5 means cap at 2.5 * bulk_per_coin_mean
}

export interface MeaResult {
  // per-coin allocation scalar (already includes tiers*mood)
  weights: Record<CoinId, Num>;
  // optional n x n matrix (depending on matrixMode)
  matrix?: Num[][];
  // trace/debug
  meta: {
    tiers: Record<CoinId, { z: Num; band: string; weight: Num }>;
    moodCoeff: Num;
    params: {
      nCoins: number;
    };
  };
}
