// Shared helpers for matrices frozen flags. Keep this module dependency-free
// so it can be used by server routes and client utilities alike.

export type MatrixFlags = {
  frozen?: boolean[][];
  frozenSymbols?: Record<string, boolean>;
};

export type FrozenPairKey = `${string}|${string}`;

const pairKey = (base: string, quote: string): FrozenPairKey =>
  `${base.toUpperCase()}|${quote.toUpperCase()}`;

/** Build a Set<"BASE|QUOTE"> from MatrixFlags provided to composeMatrices. */
export function buildFrozenSetFromFlags(
  coins: string[],
  flags?: MatrixFlags
): Set<FrozenPairKey> {
  const set = new Set<FrozenPairKey>();
  if (!flags || !Array.isArray(flags.frozen)) return set;

  const n = coins.length;
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      if (i === j) continue;
      if (flags.frozen[i]?.[j]) {
        set.add(pairKey(coins[i]!, coins[j]!));
      }
    }
  }

  // symbol-level overrides (optional)
  if (flags.frozenSymbols) {
    for (const base of coins) {
      if (flags.frozenSymbols[base]) {
        for (const quote of coins) {
          if (base !== quote) set.add(pairKey(base, quote));
        }
      }
    }
  }
  return set;
}

/** Quick check: is BASE|QUOTE frozen according to a prepared set. */
export function isPairFrozenFromSet(
  frozenSet: Set<FrozenPairKey>,
  base: string,
  quote: string
): boolean {
  return frozenSet.has(pairKey(base, quote));
}

/** Materialize a boolean[][] grid from a prepared frozen set. */
export function materializeFrozenGridFromSet(
  coins: string[],
  frozenSet: Set<FrozenPairKey>
): boolean[][] {
  const n = coins.length;
  const grid = Array.from({ length: n }, () =>
    Array.from({ length: n }, () => false)
  );

  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      if (i === j) continue;
      grid[i][j] = frozenSet.has(pairKey(coins[i]!, coins[j]!));
    }
  }
  return grid;
}
