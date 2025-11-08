// matrices.ts - full matrices composer with symbol-ring coloring

import { computeFromDbAndLive, newGrid } from "@/core/maths/math";
import type { FrozenPairKey, MatrixFlags } from "./frozen";
import {
  buildFrozenSetFromFlags,
  isPairFrozenFromSet,
  materializeFrozenGridFromSet,
} from "./frozen";
export type { MatrixFlags, FrozenPairKey } from "./frozen";
export {
  buildFrozenSetFromFlags,
  isPairFrozenFromSet,
  materializeFrozenGridFromSet,
} from "./frozen";

export type Derivation = "direct" | "inverse" | "bridged";
export type Ring = "green" | "red" | "grey" | "purple";

export type PriceBook = {
  direct: Record<string, number>;   // "BASE/QUOTE" -> price
  open24h?: Record<string, number>; // "BASE/QUOTE" -> 24h open
  prev?: Record<string, number>;
  usdt?: Record<string, number>;    // "SYM/USDT" -> price
};

export type BuildOptions = {
  quote?: string;                 // default "USDT"
  appSessionId?: string | null;
  window?: string;                // default "1h"
  nowTs?: number;                 // default Date.now()
  flags?: MatrixFlags;            // pass from matricesLatest if you have it
};

export type Cell = {
  value: number | null;
  color: string;
  derivation?: Derivation;
  ring?: Ring;
};
export type DualRow = { top: Cell; bottom: Cell };

export type MatrixRow = {
  pair: string;
  base: string;
  quote: string;
  derivation: Derivation;
  ring: Ring;
  symbolRing: Ring;       // NEW - ring color for the base symbol
  symbolFrozen: boolean;  // NEW - quick flag for UI
  benchmark_pct24h: DualRow;
  ref_block: DualRow;
  delta: Cell;
  id_pct: Cell;
  pct_drv: Cell;
  meta: { frozen: boolean };
};

// ---------- helpers

const COLORS = {
  green: ["#e6f4ea", "#c9eacb", "#a5d6a7", "#81c784", "#66bb6a", "#4caf50", "#2e7d32", "#1b5e20"],
  red:   ["#ffebee", "#ffcdd2", "#ef9a9a", "#e57373", "#ef5350", "#f44336", "#c62828", "#b71c1c"],
  neutral: "#eceff1",
  purple: "#b39ddb"
};
const PCT_BINS = [0.001, 0.0025, 0.005, 0.01, 0.02, 0.04, 0.08, 0.16];

const pctShadeIdx = (abs: number) => Math.min(PCT_BINS.findIndex(t => abs < t), PCT_BINS.length - 1);
const asPctColor = (p: number | null, frozen: boolean): string => {
  if (frozen) return COLORS.purple;
  if (p == null || !Number.isFinite(p)) return COLORS.neutral;
  const i = pctShadeIdx(Math.abs(p));
  return p >= 0 ? COLORS.green[i] : COLORS.red[i];
};

const key = (a: string, b: string) => `${a.toUpperCase()}/${b.toUpperCase()}`;
const kUSDT = (sym: string) => `${sym.toUpperCase()}/USDT`;

// "cell ring" = the pair derivation ring (kept)
const ringForPair = (deriv: Derivation, frozen: boolean): Ring => {
  if (frozen) return "purple";
  if (deriv === "direct") return "green";
  if (deriv === "inverse") return "red";
  return "grey";
};

// "symbol ring" = availability ring around the symbol icon in preview
// green: direct USDT leg exists; red: only inverse (USDT/base) exists; grey: none
function ringForSymbol(sym: string, priceBook: PriceBook, frozen: boolean): Ring {
  if (frozen) return "purple";
  const direct = Number.isFinite(priceBook.usdt?.[kUSDT(sym)]);
  // crude inverse check: if we ever see USDT/sym directly in the book
  const inverse = Number.isFinite(priceBook.direct?.[key("USDT", sym)]);
  if (direct) return "green";
  if (inverse && !direct) return "red";
  return "grey";
}

function resolvePair(priceBook: PriceBook, base: string, quote: string): { value: number | null; derivation: Derivation | null } {
  const d = priceBook.direct[key(base, quote)];
  if (Number.isFinite(d)) return { value: Number(d), derivation: "direct" };

  const inv = priceBook.direct[key(quote, base)];
  if (Number.isFinite(inv) && inv !== 0) return { value: 1 / Number(inv), derivation: "inverse" };

  const a = priceBook.usdt?.[kUSDT(base)];
  const b = priceBook.usdt?.[kUSDT(quote)];
  if (Number.isFinite(a) && Number.isFinite(b) && Number(b) !== 0) {
    return { value: Number(a) / Number(b), derivation: "bridged" };
  }

  return { value: null, derivation: null };
}

function buildLiveBenchmarkGrid(coins: string[], priceBook: PriceBook): {
  grid: (number | null)[][], derivation: (Derivation | null)[][];
} {
  const n = coins.length;
  const grid = newGrid<number | null>(n, null);
  const deriv = newGrid<Derivation | null>(n, null);

  for (let i = 0; i < n; i++) {
    const bi = coins[i]!;
    for (let j = 0; j < n; j++) {
      if (i === j) continue;
      const qj = coins[j]!;
      const { value, derivation } = resolvePair(priceBook, bi, qj);
      grid[i][j] = value;
      deriv[i][j] = derivation;
    }
  }
  return { grid, derivation: deriv };
}

// ---------- main

// -------------------------------------------------------------------------------
// Frozen flag helpers (additive; does NOT change composeMatrices behavior)
// Mirrors the logic from core/frozen.ts to resolve/consume frozen flags.
// -------------------------------------------------------------------------------

/** Build a Set<"BASE|QUOTE"> from MatrixFlags provided to composeMatrices. */
/**
 * Fetch the latest matrices payload and synthesize a frozen set.
 * Accepts both legacy shapes:
 *   - j.flags.id_pct  (boolean[][])
 *   - j.flags.id_pct.frozen  (boolean[][])
 */
export async function getFrozenSetFromMatricesLatest(
  appSessionId: string,
  cycleTs: number
): Promise<Set<FrozenPairKey>> {
  const base = process.env.INTERNAL_BASE_URL || "http://localhost:3000";
  const url =
    `${base}/api/matrices/latest` +
    `?appSessionId=${encodeURIComponent(appSessionId)}` +
    `&cycleTs=${cycleTs}&t=${Date.now()}`;

  try {
    const r = await fetch(url, { cache: "no-store" });
    if (!r.ok) return new Set<FrozenPairKey>();

    const j = await r.json();
    const coins: string[] = Array.isArray(j?.coins)
      ? j.coins.map((c: any) => String(c).toUpperCase())
      : [];

    const grid: boolean[][] | undefined =
      Array.isArray(j?.flags?.id_pct) ? (j.flags.id_pct as boolean[][])
      : j?.flags?.id_pct?.frozen;

    if (!coins.length || !grid) return new Set<FrozenPairKey>();

    const set = new Set<FrozenPairKey>();
    for (let i = 0; i < coins.length; i++) {
      for (let jdx = 0; jdx < coins.length; jdx++) {
        if (i === jdx) continue;
        if (grid[i]?.[jdx]) set.add(`${coins[i]}|${coins[jdx]}`);
      }
    }
    return set;
  } catch {
    return new Set<FrozenPairKey>();
  }
}

/** Quick check: is BASE->QUOTE frozen according to a prepared set. */


export async function composeMatrices(
  coinsIn: string[],
  priceBook: PriceBook,
  options: BuildOptions = {}
): Promise<{ rows: MatrixRow[]; grids: {
  benchmark: (number | null)[][];
  id_pct: (number | null)[][];
  pct_drv: (number | null)[][];
  pct_ref: (number | null)[][];
  ref: (number | null)[][];
  delta: (number | null)[][];
} }> {
  const coins = Array.from(new Set(coinsIn.map(c => c.toUpperCase()))).filter(Boolean);
  const quote = (options.quote ?? "USDT").toUpperCase();
  const n = coins.length;
  const nowTs = options.nowTs ?? Date.now();

  // 1) live grid
  const { grid: liveBenchmark, derivation: dgrid } = buildLiveBenchmarkGrid(coins, priceBook);

  // 2) maths core derivations (opening provided by providers at route layer)
  const out = await computeFromDbAndLive({
    coins,
    nowTs,
    liveBenchmark
  });

  // 3) assemble UI rows w/ colors + rings
  const rows: MatrixRow[] = [];
  const quoteIdx = coins.indexOf(quote);

  for (let i = 0; i < n; i++) {
    const base = coins[i]!;
    if (i === quoteIdx || quoteIdx < 0) continue;

    const frozenSymbol = Boolean(options.flags?.frozenSymbols?.[base]);

    const bm = liveBenchmark[i][quoteIdx];
    const idp = out.id_pct[i][quoteIdx];
    const pdrv = out.pct_drv[i][quoteIdx];
    const pref = out.pct_ref[i][quoteIdx];
    const refv = out.ref[i][quoteIdx];
    const dlt = out.delta[i][quoteIdx];

    // UI 24h% if we have it
    const open24 = priceBook.open24h?.[key(base, quote)];
    const pct24h =
      (bm != null && Number.isFinite(open24!) && Math.abs(Number(open24)) > 1e-12)
        ? ((bm - Number(open24)) / Number(open24))
        : null;

    // cell-level frozen overrides if provided
    const frozenCell = Boolean(options.flags?.frozen?.[i]?.[quoteIdx]);
    const frozen = frozenSymbol || frozenCell;

    const deriv = (dgrid[i][quoteIdx] ?? "bridged") as Derivation;
    const cellRing = ringForPair(deriv, frozen);
    const symRing  = ringForSymbol(base, priceBook, frozen);

    const benchTop: Cell = { value: bm ?? null, color: pct24h == null ? COLORS.neutral : asPctColor(pct24h, frozen), derivation: deriv, ring: cellRing };
    const benchBot: Cell = { value: pct24h,    color: asPctColor(pct24h, frozen),       derivation: deriv, ring: cellRing };
    const pctRefCell: Cell = { value: pref,    color: asPctColor(pref, frozen),         derivation: deriv, ring: cellRing };
    const refCell:    Cell = { value: refv,    color: asPctColor(pref, frozen),         derivation: deriv, ring: cellRing };
    const idPctCell:  Cell = { value: idp,     color: asPctColor(idp, frozen),          derivation: deriv, ring: cellRing };
    const drvCell:    Cell = { value: pdrv,    color: asPctColor(pdrv, frozen),         derivation: deriv, ring: cellRing };
    const deltaCell:  Cell = { value: dlt,     color: COLORS.neutral,                   derivation: deriv, ring: cellRing };

    rows.push({
      pair: key(base, quote),
      base, quote,
      derivation: deriv,
      ring: cellRing,
      symbolRing: symRing,
      symbolFrozen: frozenSymbol,
      benchmark_pct24h: { top: benchTop, bottom: benchBot },
      ref_block:        { top: pctRefCell, bottom: refCell },
      delta:   deltaCell,
      id_pct:  idPctCell,
      pct_drv: drvCell,
      meta: { frozen }
    });
  }


  return {
    rows,
    grids: {
      benchmark: liveBenchmark,
      id_pct: out.id_pct,
      pct_drv: out.pct_drv,
      pct_ref: out.pct_ref,
      ref: out.ref,
      delta: out.delta,
    }
  };
}

