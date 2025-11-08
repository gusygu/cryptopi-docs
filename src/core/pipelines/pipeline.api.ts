// src/core/pipelines/api_pipeline.ts
import type {
  LiveSnapshot,
  PriceBook,
  PipelineSettings,
  PollTick,
  Logger,
  DepthSnapshot,
  BalancesMap,
} from "./types";
import { getAccountBalances } from "@/core/sources/binanceAccount";

/* --------------------------- Types --------------------------- */

export type SourceAdapter = {
  fetchLiveSnapshot(
    bases: string[],
    quote: string,
    ctx: { tick: PollTick; settings: PipelineSettings; logger?: Logger }
  ): Promise<LiveSnapshot>;

  /** Exposed for specialised consumers needing raw depth data */
  fetchOrderBook?: (
    pair: string,
    depth: number,
    ctx: { tick: PollTick; settings: PipelineSettings; logger?: Logger }
  ) => Promise<DepthSnapshot>;

  fetchOrderBooksByPairs?: (
    pairs: string[],
    depth: number,
    ctx: { tick: PollTick; settings: PipelineSettings; logger?: Logger }
  ) => Promise<Record<string, DepthSnapshot>>;

  fetchOrderBooks?(
    bases: string[],
    quote: string,
    depth: number,
    ctx: { tick: PollTick; settings: PipelineSettings; logger?: Logger }
  ): Promise<Record<string, DepthSnapshot>>;
};

/* -------------------------- Helpers -------------------------- */

type Ticker24h = {
  symbol: string;
  lastPrice?: string;
  weightedAvgPrice?: string;
  priceChangePercent?: string;
};

type BinanceDepthRaw = {
  lastUpdateId?: number;
  bids: [string, string][];
  asks: [string, string][];
};

const SYM = (pair: string) => pair.replace("/", "");
const P = (b: string, q: string) => `${b}/${q}`;
const DEFAULT_DEPTH = 50;

function num(x: any): number | null {
  const n = Number(x);
  return Number.isFinite(n) ? n : null;
}

function estOpen(last: number | null, pctStr?: string): number | null {
  const pct = pctStr != null ? Number(pctStr) : NaN;
  if (last == null || !Number.isFinite(pct)) return null;
  const r = 1 + pct / 100;
  return Math.abs(r) < 1e-12 ? null : last / r;
}

async function fetchBinance24h(symbols: string[]): Promise<Ticker24h[]> {
  if (!symbols.length) return [];
  const body = encodeURIComponent(JSON.stringify(symbols));
  const mirrors = [
    `https://api.binance.com/api/v3/ticker/24hr?symbols=${body}`,
    `https://api1.binance.com/api/v3/ticker/24hr?symbols=${body}`,
    `https://api2.binance.com/api/v3/ticker/24hr?symbols=${body}`,
  ];
  for (const u of mirrors) {
    try {
      const r = await fetch(u, { headers: { accept: "application/json" } });
      if (r.ok) return await r.json();
    } catch {
      // try next mirror
    }
  }
  return [];
}

const DEPTH_BUCKETS = [5, 10, 20, 50, 100, 500, 1000, 5000];
function normalizeDepth(n: number): number {
  const req = Math.max(1, Math.floor(n));
  for (const b of DEPTH_BUCKETS) if (b >= req) return b;
  return DEPTH_BUCKETS[DEPTH_BUCKETS.length - 1];
}

async function fetchBinanceDepth(symbol: string, limit: number): Promise<BinanceDepthRaw | null> {
  const lim = normalizeDepth(limit);
  const mirrors = [
    `https://api.binance.com/api/v3/depth?symbol=${encodeURIComponent(symbol)}&limit=${lim}`,
    `https://api1.binance.com/api/v3/depth?symbol=${encodeURIComponent(symbol)}&limit=${lim}`,
    `https://api2.binance.com/api/v3/depth?symbol=${encodeURIComponent(symbol)}&limit=${lim}`,
  ];
  for (const u of mirrors) {
    try {
      const r = await fetch(u, { headers: { accept: "application/json" } });
      if (r.ok) return await r.json();
    } catch {
      // try next mirror
    }
  }
  return null;
}

function mapDepth(pair: string, raw: BinanceDepthRaw | null): DepthSnapshot {
  if (!raw) return { pair, bids: [], asks: [], source: "binance" };
  const bids = (raw.bids ?? []).map(([p, q]) => [Number(p), Number(q)] as [number, number]);
  const asks = (raw.asks ?? []).map(([p, q]) => [Number(p), Number(q)] as [number, number]);
  return { pair, lastUpdateId: raw.lastUpdateId, bids, asks, source: "binance" };
}

async function buildPriceBook(
  bases: string[],
  quote: string,
  logger?: Logger
): Promise<PriceBook> {
  const B = [...new Set(bases.map((s) => s.toUpperCase()))];
  const Q = quote.toUpperCase();
  const directSyms = B.filter((b) => b !== Q).map((b) => SYM(P(b, Q)));
  const usdtLegs = B.filter((b) => b !== "USDT").map((b) => `${b}USDT`);
  const symbols = [...new Set([...directSyms, ...usdtLegs])];

  logger?.debug?.("api:binance:tickers", { symbols: symbols.length });
  const tickers = await fetchBinance24h(symbols);

  const direct: Record<string, number> = {};
  const open24h: Record<string, number> = {};
  const usdt: Record<string, number> = {};

  for (const t of tickers) {
    const last = num(t.lastPrice) ?? num(t.weightedAvgPrice);
    const open = estOpen(last, t.priceChangePercent);

    if (t.symbol.endsWith("USDT")) {
      const base = t.symbol.slice(0, -4);
      if (last != null) usdt[P(base, "USDT")] = last;
      if (open != null) open24h[P(base, "USDT")] = open;
    }
    if (t.symbol.endsWith(Q)) {
      const base = t.symbol.slice(0, -Q.length);
      if (last != null) direct[P(base, Q)] = last;
      if (open != null) open24h[P(base, Q)] = open;
    }
  }

  return { direct, open24h, usdt };
}

async function buildOrderBooks(
  bases: string[],
  quote: string,
  depth: number,
  logger?: Logger
): Promise<Record<string, DepthSnapshot>> {
  const Q = quote.toUpperCase();
  const pairs = [...new Set(
    bases
      .map((s) => s.toUpperCase())
      .filter((b) => b !== Q)
      .map((b) => P(b, Q))
  )];

  logger?.debug?.("api:binance:orderbooks", { pairs: pairs.length, depth });

  const out: Record<string, DepthSnapshot> = {};
  await Promise.all(
    pairs.map(async (pair) => {
      const raw = await fetchBinanceDepth(pair.replace("/", ""), depth);
      out[pair] = mapDepth(pair, raw);
    })
  );
  return out;
}

/* ------------------------ Binance adapter ----------------------- */

export const binanceAdapter: SourceAdapter = {
  async fetchLiveSnapshot(bases, quote, ctx) {
    const priceBook = await buildPriceBook(bases, quote, ctx.logger);
    const depth = DEFAULT_DEPTH;
    const orderBooks = await buildOrderBooks(bases, quote, depth, ctx.logger);
    let wallet: BalancesMap = {};
    try {
      wallet = await getAccountBalances();
    } catch (error) {
      ctx.logger?.warn?.("api:binance:wallet:error", error);
    }
    return { priceBook, orderBooks, wallet };
  },

  async fetchOrderBook(pair, depth, ctx) {
    const symbol = pair.replace("/", "").toUpperCase();
    ctx.logger?.debug?.("api:binance:depth", { pair, depth: normalizeDepth(depth) });
    const raw = await fetchBinanceDepth(symbol, depth);
    return mapDepth(pair.toUpperCase(), raw);
  },

  async fetchOrderBooksByPairs(pairs, depth, ctx) {
    const out: Record<string, DepthSnapshot> = {};
    await Promise.all(
      pairs.map(async (pair) => {
        out[pair.toUpperCase()] = await this.fetchOrderBook!(pair, depth, ctx);
      })
    );
    return out;
  },

  async fetchOrderBooks(bases, quote, depth, ctx) {
    return buildOrderBooks(bases, quote, depth, ctx.logger);
  },
};


/* ----------------------- Adapter factory ----------------------- */

export function getSourceAdapter(settings: PipelineSettings): SourceAdapter {
  switch (settings.matrices.source) {
    case "binance":
      return binanceAdapter;
    default:
      return binanceAdapter;
  }
}

// Straight plumbing: build LiveSnapshot with no adapter indirection

export async function fetchLiveSnapshotBasic(
  bases: string[],
  quote: string,
  ctx: { tick: PollTick; settings: PipelineSettings; logger?: Logger }
): Promise<LiveSnapshot> {
  const priceBook = await buildPriceBook(bases, quote, ctx.logger);
  const orderBooks = await buildOrderBooks(bases, quote, 50, ctx.logger);
  let wallet: BalancesMap | undefined;

  try {
    wallet = await getAccountBalances().catch(() => undefined);
  } catch {
    wallet = undefined;
  }

  return { priceBook, orderBooks, wallet: wallet ?? {} as any };
}

