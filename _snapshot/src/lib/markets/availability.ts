// src/lib/markets/availability.ts
// Resolve tradable symbol availability and helper utilities to align UI matrices.

import { buildValidPairsFromCoins, type TradableSymbol } from "@/core/sources/pairs";

const normalizeCoins = (coins: readonly string[]): string[] => {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const coin of coins ?? []) {
    const normalized = String(coin ?? "").trim().toUpperCase();
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    out.push(normalized);
  }
  return out;
};

export type PairAvailabilitySnapshot = {
  pairs: TradableSymbol[];
  symbols: string[];
  set: Set<string>;
};

export async function resolvePairAvailability(
  coins: readonly string[]
): Promise<PairAvailabilitySnapshot> {
  const normalized = normalizeCoins(coins);
  if (!normalized.length) {
    return { pairs: [], symbols: [], set: new Set<string>() };
  }

  const pairs = await buildValidPairsFromCoins(normalized);
  const symbols = pairs.map((entry) => String(entry.symbol ?? "").toUpperCase());
  const set = new Set(symbols);
  return { pairs, symbols, set };
}

const upper = (value: string) => String(value ?? "").toUpperCase();

export function maskUnavailableMatrix(
  matrix: Record<string, Record<string, unknown>> | undefined,
  allowed: Set<string>,
  replacement: unknown = null
) {
  if (!matrix || !allowed.size) return;

  for (const [baseKey, row] of Object.entries(matrix)) {
    if (!row || typeof row !== "object") continue;
    const base = upper(baseKey);
    for (const quoteKey of Object.keys(row)) {
      const quote = upper(quoteKey);
      if (base === quote) continue;
      const symbol = `${base}${quote}`;
      if (!allowed.has(symbol)) {
        (row as Record<string, unknown>)[quoteKey] = replacement;
      }
    }
  }
}

