import { buildMeaAux, buildMeaAuxForCycle, type BalancesMap } from "../src/core/features/mea-aux/grid";
import { fromEndpointsToGrids, type SettingsAPI, type MarketAPI } from "../src/core/features/mea-aux/wire";
import { computeMoodCoeffUsingCurrentMetrics } from "../src/core/features/mea-aux/measures";
import type { TierRule } from "../src/core/features/mea-aux/tiers";

export async function buildMeaFromSettingsAndPairs(params: {
  ts_ms: number;
  appSessionId: string;
  cycleTs: number;
  getFrozenSet?: (appSessionId: string, cycleTs: number) => Promise<Set<string>>;
  balances: BalancesMap;             // your wallet balances map { "BTC": 100, ... }
  rules?: TierRule[];
  settingsAPI: SettingsAPI;
  marketAPI: MarketAPI;
}) {
  const { settingsAPI, marketAPI, balances, rules, ts_ms, appSessionId, cycleTs, getFrozenSet } = params;

  const { coins, idPct, coverage } = await fromEndpointsToGrids(settingsAPI, marketAPI);
  const { coeff: moodCoeff } = await computeMoodCoeffUsingCurrentMetrics(ts_ms);

  // you already have a ForCycle variant; reuse it so freezing is honored
  const { coins: C, grid, pairs } = await buildMeaAuxForCycle({
    appSessionId,
    cycleTs,
    coins,
    idPct,
    balances,
    rules,
    coverage,
    k: coins.length - 1,
    getFrozenSet,
  });

  // Apply mood scaling on top (if not already applied inside buildMeaAux)
  // If you prefer inside buildMeaAux, pass moodCoeff to it and skip here.
  for (const base of C) {
    for (const quote of C) {
      if (quote === base) continue;
      const v = grid[base]?.[quote];
      if (v != null) grid[base][quote] = (v as number) * moodCoeff;
    }
  }

  return { coins: C, grid, pairs, moodCoeff };
}
