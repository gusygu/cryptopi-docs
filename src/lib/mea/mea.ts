// mea.ts — tiers + compute

export type CoinId = string;
export type IdPctGrid = Record<CoinId, Record<CoinId, number | null>>;
export type CoverageGrid = Record<CoinId, Record<CoinId, boolean>>;
export type BalancesMap = Record<CoinId, number>;

export type TierBand = { name: string; zMin: number; zMax: number; weight: number };
export type MatrixMode = "vector" | "diagonal" | "outer";

export type MeaConfig = {
  bands?: TierBand[];
  eps?: number;
  clampMin?: number;
  clampMax?: number;
  perCoinCap?: number; // multiplier vs mean bulk
  matrixMode?: MatrixMode;
};

export type MeaResult = {
  weights: Record<CoinId, number>;
  matrix?: number[][];
  meta: {
    moodCoeff: number;
    tiers: Record<CoinId, Record<CoinId, { tier: string; weight: number; z: number }>>;
  };
};

const clamp = (x: number, lo = -Infinity, hi = Infinity) => Math.min(Math.max(x, lo), hi);

const DEFAULT_BANDS: TierBand[] = [
  { name: "flat",    zMin: 0.00, zMax: 0.25,    weight: 0.2 },
  { name: "slight",  zMin: 0.25, zMax: 0.75,    weight: 0.4 },
  { name: "normal",  zMin: 0.75, zMax: 1.50,    weight: 1.0 },
  { name: "high",    zMin: 1.50, zMax: 2.50,    weight: 1.5 },
  { name: "extreme", zMin: 2.50, zMax: Infinity,weight: 2.0 },
];

function safeZ(idPct: number, baseline: number, eps = 1e-9) {
  const den = Math.max(Math.abs(baseline), eps);
  return Math.abs((idPct - baseline) / den);
}

function pickTier(idPct: number, baseline: number, bands: TierBand[], eps: number) {
  const z = safeZ(idPct, baseline, eps);
  const band = bands.find(b => z >= b.zMin && z < b.zMax) ?? bands[bands.length - 1];
  return { z, tier: band.name, weight: band.weight };
}

/**
 * Compute MEA weights and optional matrix.
 * bulk_per_coin * n_coins * tierWeight * moodCoeff
 */
export function computeMEA(params: {
  coins: CoinId[];
  balances: BalancesMap;
  idPct: IdPctGrid;
  // optional:
  coverage?: CoverageGrid;
  idPctBaseline?: number; // shared baseline (%), default 1.0
  moodCoeff?: number;     // from mood.ts
  config?: MeaConfig;
}): MeaResult {
  const {
    coins,
    balances,
    idPct,
    coverage,
    idPctBaseline = 1.0,
    moodCoeff = 1.0,
    config,
  } = params;

  const bands = config?.bands ?? DEFAULT_BANDS;
  const eps = config?.eps ?? 1e-9;
  const clampMin = config?.clampMin ?? 0;
  const clampMax = config?.clampMax ?? Infinity;
  const perCoinCap = config?.perCoinCap ?? Infinity;
  const mode = config?.matrixMode ?? "diagonal";

  const n = coins.length;
  const bulkMean = coins.reduce((s, c) => s + (balances[c] ?? 0), 0) / Math.max(1, n);

  const weights: Record<CoinId, number> = {};
  const tiersMeta: MeaResult["meta"]["tiers"] = {};

  // per-coin scalar from rows (aggregate across quotes)
  for (const base of coins) {
    const avail = balances[base] ?? 0;
    let agg = 0;
    tiersMeta[base] = {};
    for (const quote of coins) {
      if (quote === base) continue;
      if (coverage && coverage[base] && coverage[base][quote] === false) continue;
      const idp = idPct?.[base]?.[quote];
      if (idp == null) continue;
      const { tier, weight, z } = pickTier(idp, idPctBaseline, bands, eps);
      tiersMeta[base][quote] = { tier, weight, z };
      agg += weight;
    }
    const k = Math.max(1, n - 1);
    let w = avail * (agg / k) * moodCoeff * n;
    if (Number.isFinite(perCoinCap)) w = Math.min(w, perCoinCap * bulkMean);
    weights[base] = clamp(Number.isFinite(w) ? w : 0, clampMin, clampMax);
  }

  let matrix: number[][] | undefined;
  if (mode === "diagonal") {
    matrix = coins.map((r, i) => coins.map((_, j) => (i === j ? weights[r] : 0)));
  } else if (mode === "outer") {
    const vals = coins.map(c => weights[c]);
    matrix = vals.map(vi => vals.map(vj => vi * vj));
  }

  return { weights, matrix, meta: { moodCoeff, tiers: tiersMeta } };
}
