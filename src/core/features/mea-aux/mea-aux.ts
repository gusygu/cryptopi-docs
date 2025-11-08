// mea-aux.ts — orchestrator

import { computeMEA, type IdPctGrid, type CoverageGrid, type BalancesMap } from "@/lib/mea/mea";
import { computeMoodCoeffV1, moodUUIDFromBuckets, type MoodInputs } from "@/lib/mea/mood";

export type SettingsAPI = {
  getCoinUniverse: () => Promise<string[]>;
};

export type MarketAPI = {
  getPairsSnapshot: (coins: string[]) => Promise<Array<{
    base: string; quote: string; id_pct: number | null; tradable: boolean;
  }>>;
};

export async function buildMeaFromSources(params: {
  settings: SettingsAPI;
  market: MarketAPI;
  balances: BalancesMap;
  // Provide mood inputs from your metrics assembler (or call another service)
  moodInputs: MoodInputs;
  idPctBaseline?: number;
}) {
  const { settings, market, balances, moodInputs, idPctBaseline = 1.0 } = params;

  const coins = await settings.getCoinUniverse();

  // shape grids
  const idPct: IdPctGrid = {};
  const coverage: CoverageGrid = {};
  for (const b of coins) { idPct[b] = {}; coverage[b] = {}; for (const q of coins) {
    idPct[b][q] = null; coverage[b][q] = false;
  }}

  const pairs = await market.getPairsSnapshot(coins);
  for (const p of pairs) {
    idPct[p.base][p.quote] = p.id_pct;
    coverage[p.base][p.quote] = !!p.tradable;
  }

  const { coeff: moodCoeff, buckets } = computeMoodCoeffV1(moodInputs);
  const moodUUID = moodUUIDFromBuckets(buckets);

  const res = computeMEA({
    coins,
    balances,
    idPct,
    coverage,
    idPctBaseline,
    moodCoeff,
    config: {
      matrixMode: "diagonal",
      perCoinCap: 3.0,
      clampMin: 0,
      clampMax: Number.POSITIVE_INFINITY,
    },
  });

  return { ...res, coins, pairs, moodUUID };
}
