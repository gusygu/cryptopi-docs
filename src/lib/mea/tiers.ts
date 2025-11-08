import { CoinSnapshot, TierBand, TierConfig } from "./types";
import { safeDiv } from "./normalize";

const defaultBands: TierBand[] = [
  { name: "flat",    zMin: 0.0, zMax: 0.25, weight: 0.2 },
  { name: "slight",  zMin: 0.25, zMax: 0.75, weight: 0.4 },
  { name: "normal",  zMin: 0.75, zMax: 1.50, weight: 1.0 },
  { name: "high",    zMin: 1.50, zMax: 2.50, weight: 1.5 },
  { name: "extreme", zMin: 2.50, zMax: Infinity, weight: 2.0 },
];

export const pickTier = (coin: CoinSnapshot, cfg?: TierConfig) => {
  const eps = cfg?.eps ?? 1e-9;
  const bands = cfg?.bands ?? defaultBands;
  // compute |z| = |(idPct - baseline)/max(baseline, eps)|
  const z = Math.abs(safeDiv(coin.idPct - coin.idPctBaseline, Math.max(Math.abs(coin.idPctBaseline), eps), eps));
  const band = bands.find(b => z >= b.zMin && z < b.zMax) ?? bands[bands.length - 1];
  return { z, band };
};

export const computeTierWeights = (coins: CoinSnapshot[], cfg?: TierConfig) => {
  const out: Record<string, { z: number; band: string; weight: number }> = {};
  coins.forEach(c => {
    const { z, band } = pickTier(c, cfg);
    out[c.id] = { z, band: band.name, weight: band.weight };
  });
  return out;
};
