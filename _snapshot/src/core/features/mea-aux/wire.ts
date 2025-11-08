import type { IdPctGrid } from "./grid";

/** Inject your real sources here (adapters keep core pure). */
export type SettingsAPI = {
  getCoinUniverse: () => Promise<string[]>; // e.g. ["BTC","ETH","SOL"]
};

export type MarketAPI = {
  // returns id_pct for a pair and whether it's tradable
  // Suggestion: GET /market/pairs?universe=BTC,ETH,SOL => array of { base, quote, id_pct, tradable }
  getPairsSnapshot: (coins: string[]) => Promise<Array<{ base: string; quote: string; id_pct: number | null; tradable: boolean }>>;
};

export async function fromEndpointsToGrids(
  settings: SettingsAPI,
  market: MarketAPI
): Promise<{ coins: string[]; idPct: IdPctGrid; coverage: Record<string, Record<string, boolean>> }> {
  const coins = await settings.getCoinUniverse();
  const pairs = await market.getPairsSnapshot(coins);

  const idPct: IdPctGrid = {};
  const coverage: Record<string, Record<string, boolean>> = {};

  for (const b of coins) {
    idPct[b] = idPct[b] || {};
    coverage[b] = coverage[b] || {};
    for (const q of coins) {
      if (b === q) { idPct[b][q] = null; coverage[b][q] = false; continue; }
      idPct[b][q] = null; coverage[b][q] = false;
    }
  }

  for (const p of pairs) {
    if (!idPct[p.base]) idPct[p.base] = {};
    idPct[p.base][p.quote] = p.id_pct ?? null;
    if (!coverage[p.base]) coverage[p.base] = {};
    coverage[p.base][p.quote] = !!p.tradable;
  }

  return { coins, idPct, coverage };
}
