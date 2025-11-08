// PATCH: src/core/features/mea-aux/grid.ts
import type { TierRule } from "./tiers";
import { DEFAULT_TIER_RULES, getTierWeighting } from "./tiers";

export type IdPctGrid = Record<string, Record<string, number | null>>;
export type BalancesMap = Record<string, number>;
export type MeaAuxGrid = Record<string, Record<string, number | null>>;
export type MeaPair = { base: string; quote: string; value: number; frozen?: boolean };

export function pickTierName(idp: number, rules: TierRule[] = DEFAULT_TIER_RULES): string | undefined {
  const a = Math.abs(Number(idp || 0));
  const r = rules.find(r => a >= r.minAbs && (r.maxAbs == null || a <= r.maxAbs));
  return r?.name;
}

export function buildMeaAux(params: {
  coins: string[];
  idPct: IdPctGrid;
  balances: BalancesMap;
  k?: number;
  rules?: TierRule[];
  coverage?: Record<string, Record<string, boolean>>;
  moodCoeff?: number; // NEW
}): MeaAuxGrid {
  const { coins, idPct, balances, coverage, rules = DEFAULT_TIER_RULES } = params;
  const k = Math.max(1, params.k ?? coins.length - 1);
  const mood = Number.isFinite(params.moodCoeff ?? 1) ? (params.moodCoeff as number) : 1;

  const out: MeaAuxGrid = {};
  for (const base of coins) {
    const avail = balances[base] ?? 0;
    const row: Record<string, number | null> = {};
    for (const quote of coins) {
      if (quote === base) { row[quote] = null; continue; }
      if (coverage && coverage[base] && coverage[base][quote] === false) { row[quote] = null; continue; }

      const idp = idPct?.[base]?.[quote];
      const w = getTierWeighting(Number(idp ?? 0), rules); // legacy bin weight
      const cell = avail * (1 / k) * w * mood; // APPLY mood here
      row[quote] = Number.isFinite(cell) ? cell : 0;
    }
    out[base] = row;
  }
  return out;
}

// ...rest unchanged...

export function toRenderableRows(mea: Record<string, Record<string, {
  id_pct: number;
  weight: number;
  tierName?: string;
  isNull?: boolean;
}>>){
  // keeps your existing shape (no change needed)
}
