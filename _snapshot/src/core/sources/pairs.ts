// src/core/sources/pairs.ts
// Discover & validate Binance trading pairs for a given coin universe.
// Uses public /api/v3/exchangeInfo endpoint (no API key).

import { fetchJson } from "@/core/sources/binanceClient";

type ExchangeInfoSymbol = {
  symbol?: string;
  baseAsset?: string;
  quoteAsset?: string;
  status?: string;
};

type ExchangeInfoResponse = {
  symbols?: ExchangeInfoSymbol[];
};

// light in-memory cache (to keep network low for UIs switching panels)
let symbolCacheAt = 0;
let cachedSymbols: Array<{ symbol: string; base: string; quote: string; status: string }> | null = null;
const SYMBOL_TTL_MS = 60_000; // 60s

export type TradableSymbol = { symbol: string; base: string; quote: string };

export async function fetchTradableSymbols(): Promise<TradableSymbol[]> {
  const now = Date.now();
  if (cachedSymbols && now - symbolCacheAt < SYMBOL_TTL_MS) {
    return cachedSymbols.filter((s) => s.status === "TRADING");
  }

  const info = await fetchJson<ExchangeInfoResponse>("/api/v3/exchangeInfo");
  const list = Array.isArray(info.symbols) ? info.symbols : [];
  cachedSymbols = list.map((entry) => ({
    symbol: String(entry.symbol ?? ""),
    base: String(entry.baseAsset ?? ""),
    quote: String(entry.quoteAsset ?? ""),
    status: String(entry.status ?? ""),
  }));
  symbolCacheAt = now;
  return cachedSymbols.filter((s) => s.status === "TRADING");
}

/** From a coin list, build all directionally valid pairs that Binance lists. */
export async function buildValidPairsFromCoins(coins: string[]): Promise<TradableSymbol[]> {
  const tradables = await fetchTradableSymbols();
  const map = new Map<string, TradableSymbol>();
  for (const s of tradables) map.set(`${s.base}|${s.quote}`, s);

  const seen = new Set<string>();
  const out: TradableSymbol[] = [];
  for (const base of coins) {
    for (const quote of coins) {
      if (!base || !quote || base === quote) continue;
      const key = `${base.toUpperCase()}|${quote.toUpperCase()}`;
      const hit = map.get(key);
      if (hit && !seen.has(hit.symbol)) {
        seen.add(hit.symbol);
        out.push({ symbol: hit.symbol, base: hit.base, quote: hit.quote });
      }
    }
  }
  return out;
}

/** Validate a requested base/quote; returns the Binance symbol or null. */
export async function validatePair(base: string, quote: string): Promise<string | null> {
  const tradables = await fetchTradableSymbols();
  const found = tradables.find(
    (s) => s.base.toUpperCase() === base.toUpperCase() && s.quote.toUpperCase() === quote.toUpperCase()
  );
  return found ? found.symbol : null;
}

/** Validate a requested symbol (e.g., "ETHBTC"); returns {base, quote} or null. */
export async function parseSymbol(symbol: string): Promise<{ base: string; quote: string } | null> {
  const tradables = await fetchTradableSymbols();
  const normalized = String(symbol || "").toUpperCase();
  const hit = tradables.find((s) => s.symbol.toUpperCase() === normalized);
  return hit ? { base: hit.base, quote: hit.quote } : null;
}

