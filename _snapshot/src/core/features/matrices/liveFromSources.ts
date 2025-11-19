// src/core/features/matrices/liveFromSources.ts
// Build live benchmark & pct24h using YOUR binance.ts without changing it.
// We pre-filter symbols with listSymbolsByQuote('USDT') so /24hr bulk never 400s.

import {
  listSymbolsByQuote,
  fetch24hAll,
  mapTickerBySymbol,
  usdtSymbolsFor,
} from "@/core/sources/binance";

type MatValues = Record<string, Record<string, number | null>>;
type Mat = { ts: number; prevTs: number | null; values: MatValues; flags?: any };

const normCoins = (xs: string[]) => {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const x of xs) {
    const u = String(x || "").toUpperCase().trim();
    if (!u || seen.has(u)) continue;
    seen.add(u); out.push(u);
  }
  if (!seen.has("USDT")) out.push("USDT");
  return out;
};

const makeGrid = <T extends number | null>(coins: string[], fn: (b:string,q:string)=>T): MatValues => {
  const out: MatValues = {};
  for (const b of coins) {
    out[b] = {} as any;
    for (const q of coins) {
      if (b === q) continue;
      out[b][q] = fn(b, q);
    }
  }
  return out;
};

export async function liveFromSources(requestedCoins: string[]) {
  // normalize + ensure USDT present
  const seed = normCoins(requestedCoins);

  // Step 1: Build desired USDT symbols for seed
  const desired = usdtSymbolsFor(seed); // ["BTCUSDT","ETHUSDT",...]

  // Step 2: Ask Binance which USDT symbols actually exist (TRADING)
  // Keeping this call here (read-only) guarantees no 400s later.
  const tradableSet = new Set(await listSymbolsByQuote("USDT"));

  // Step 3: Filter desired symbols down to the tradable set before calling bulk 24hr
  const symbols = desired.filter((s) => tradableSet.has(s));

  // If nothing valid (unlikely), return a minimal payload to avoid 500s.
  if (!symbols.length) {
    const now = Date.now();
    return {
      ok: true,
      coins: ["USDT"],
      matrices: {
        benchmark: { ts: now, prevTs: null, values: {}, flags: { source: "binance:empty" } },
        pct24h:    { ts: now, prevTs: null, values: {}, flags: { source: "binance:empty" } },
      }
    } as const;
  }
  
  // Step 4: Bulk fetch once using your helper (kept unchanged)
  const arr = await fetch24hAll(symbols);
  const by  = mapTickerBySymbol(arr);

  // Step 5: Build per-coin USDT price & pct24h
  const price: Record<string, number> = { USDT: 1 };
  const pct:   Record<string, number> = { USDT: 0 }; // percent units

  for (const sym of symbols) {
    // sym like "BTCUSDT" -> coin = "BTC"
    const coin = sym.endsWith("USDT") ? sym.slice(0, -4) : undefined;
    if (!coin) continue;
    const t = by[sym];
    const last = t?.lastPrice != null ? Number(t.lastPrice) : Number(t?.weightedAvgPrice);
    const pct24 = t?.priceChangePercent != null ? Number(t.priceChangePercent) : NaN;

    if (Number.isFinite(last)) {
      price[coin] = last; // coin in USDT
      pct[coin]   = Number.isFinite(pct24) ? pct24 : 0; // still in percent units
    }
  }

  // Keep only coins we actually got a price for (+USDT)
  const coins = ["USDT", ...Object.keys(price).filter(c => c !== "USDT")];

  const now = Date.now();

  // benchmark = price_b / price_q
  const benchmark: Mat = {
    ts: now,
    prevTs: null,
    values: makeGrid(coins, (b, q) => {
      const pb = price[b] ?? (b === "USDT" ? 1 : NaN);
      const pq = price[q] ?? (q === "USDT" ? 1 : NaN);
      if (!Number.isFinite(pb) || !Number.isFinite(pq) || pq === 0) return null;
      return pb / pq;
    }),
    flags: { source: "binance:usdt-legs" },
  };

  // pct24h(pair) ~ ((1+rb)/(1+rq)) - 1, with rb/rq as DECIMALS from per-coin percent
  const pct24h: Mat = {
    ts: now,
    prevTs: null,
    values: makeGrid(coins, (b, q) => {
      const rb = b === "USDT" ? 0 : (pct[b] ?? NaN) / 100;
      const rq = q === "USDT" ? 0 : (pct[q] ?? NaN) / 100;
      if (!Number.isFinite(rb) || !Number.isFinite(rq)) return null;
      const nb = 1 + rb, nq = 1 + rq;
      if (nq === 0) return null;
      return (nb / nq) - 1;
    }),
    flags: { source: "binance:usdt-legs" },
  };

  return {
    ok: true,
    coins,
    matrices: { benchmark, pct24h },
  } as const;
}

