/* ----------------------------------------------------------------------------------
 * File: src/core/converters/providers/matrices.module.ts
 * Purpose: Bridge module/local matrix loaders into the converter contract.
 * ---------------------------------------------------------------------------------- */

import type { MatricesProvider, MatrixKey, MatrixSnapshot } from "@/core/converters/provider.types";

export type MatricesModuleDeps = {
  getMatrix: (
    coins: string[],
    fields?: string[]
  ) => Promise<{
    coins: string[];
    benchmark?: number[][];
    id_pct?: number[][];
    pct_drv?: number[][];
    [key: string]: number[][] | undefined;
  }>;
  getDerived?: (coins: string[]) => Promise<{ coins: string[]; id_pct: number[][] }>;
};

const ensureUpper = (s: string | undefined) => String(s ?? "").trim().toUpperCase();

function normalizeCoins(coins: string[]): string[] {
  return Array.from(new Set(coins.map(ensureUpper)));
}

function normalizeGrid(coins: string[], grid?: number[][]): number[][] | undefined {
  if (!grid) return undefined;
  const n = coins.length;
  const out: number[][] = Array.from({ length: n }, () => Array.from({ length: n }, () => 0));
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      if (i === j) continue;
      const v = grid?.[i]?.[j];
      const num = Number(v);
      out[i][j] = Number.isFinite(num) ? num : 0;
    }
  }
  return out;
}

export function makeMatricesModuleProvider(deps: MatricesModuleDeps): MatricesProvider {
  const loadSnapshot = async (coins: string[], keys?: MatrixKey[]): Promise<MatrixSnapshot> => {
    const normalizedCoins = normalizeCoins(coins);
    const base = await deps.getMatrix(normalizedCoins, ["benchmark", "id_pct", "pct_drv"]);

    const grids: Partial<Record<MatrixKey, number[][]>> = {};
    const selector = keys ? new Set(keys) : null;

    const add = (key: MatrixKey, grid?: number[][]) => {
      if (!grid) return;
      if (selector && !selector.has(key)) return;
      const norm = normalizeGrid(normalizedCoins, grid);
      if (norm) grids[key] = norm;
    };

    add("benchmark", base.benchmark);

    if (selector?.has("id_pct") || !selector) {
      if (base.id_pct) {
        add("id_pct", base.id_pct);
      } else if (deps.getDerived) {
        const derived = await deps.getDerived(normalizedCoins);
        add("id_pct", derived.id_pct);
      }
    }

    add("pct_drv", base.pct_drv);

    return {
      coins: normalizedCoins,
      grids,
    };
  };

  return {
    async getSnapshot({ coins, keys }) {
      return loadSnapshot(coins, keys);
    },
    async getBenchmarkGrid(coins) {
      const snap = await loadSnapshot(coins, ["benchmark"]);
      return snap.grids.benchmark;
    },
    async getIdPctGrid(coins) {
      const snap = await loadSnapshot(coins, ["id_pct"]);
      return snap.grids.id_pct;
    },
    async getPctDrvGrid(coins) {
      const snap = await loadSnapshot(coins, ["pct_drv"]);
      return snap.grids.pct_drv;
    },
  };
}
