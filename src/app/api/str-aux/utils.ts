import { getAll as getSettings } from "@/lib/settings/server";
import { pairsFromSettings, usdtLegsFromCoins, normalizeCoin, type PairAvailability } from "@/lib/markets/pairs";
const norm = normalizeCoin;
import {
  fetchKlines,
  fetchOrderBook,
  fetch24hAll,
  type RawKline,
} from "@/core/sources/binance";
import { computeFM, computeIdhrBinsN } from "@/core/features/str-aux/frame/idhr";

export type WindowKey = "30m" | "1h" | "3h";

export type StrAuxTiming = {
  autoRefreshMs?: number;
  secondaryEnabled?: boolean;
  secondaryCycles?: number;
};

export type StreamsRow = { prev: number | null; cur: number | null; greatest: number | null };

export type CoinOut = {
  ok: boolean;
  symbol: string;
  window: WindowKey;
  bins: number;
  n: number;
  lastUpdateTs: number | null;
  openingTs: number | null;
  cards?: {
    opening?: { benchmark?: number | null; pct24h?: number | null };
    live?: { benchmark?: number | null; pct24h?: number | null; pct_drv?: number | null };
  };
  sessionStats?: {
    priceMin: number | null;
    priceMax: number | null;
    benchPctMin: number | null;
    benchPctMax: number | null;
  };
  streams?: {
    benchmark?: StreamsRow;
    pct24h?: StreamsRow;
    pct_drv?: StreamsRow;
  };
  fm?: {
    gfm_price?: number | null;
    gfm_calc_price?: number | null;
    gfm_ref_price?: number | null;
    sigma?: number | null;
    zAbs?: number | null;
    vInner?: number | null;
    vOuter?: number | null;
    inertia?: number | null;
    disruption?: number | null;
    nuclei?: Array<{ binIndex: number }>;
  };
  hist?: {
    counts: number[];
    zStep: number;
  };
  gfmDelta?: {
    anchorPrice?: number | null;
    price?: number | null;
    absPct?: number | null;
  };
  swaps?: number | null;
  shifts?: number | null;
  meta?: {
    uiEpoch?: number | null;
  };
  error?: string;
};

export type StrAuxBinsResponse = {
  ok: boolean;
  ts: number;
  window: WindowKey;
  symbols: string[];
  out: Record<string, CoinOut>;
  available: PairAvailability;
  selected: string[];
  timing?: StrAuxTiming;
};

export type MarketPoint = { ts: number; price: number; volume: number };

type SymbolContext = {
  symbol: string;
  window: WindowKey;
  bins: number;
  ticker?: Record<string, unknown> | null;
};

type BuildOptions = {
  tokens: string[];
  window: WindowKey;
  bins: number;
  allowUnverified: boolean;
  hideNoData: boolean;
  appSessionId: string;
};

function parseListParam(tokens: string[]): string[] {
  const out: string[] = [];
  for (const raw of tokens ?? []) {
    const trimmed = String(raw ?? '').trim();
    if (trimmed) out.push(trimmed);
  }
  return out;
}

export function parseWindow(raw: string | null | undefined): WindowKey {
  const v = (raw ?? "1h").toLowerCase();
  return v === "30m" || v === "3h" ? (v as WindowKey) : "1h";
}

export function parseBins(raw: string | null | undefined, dflt = 128): number {
  const n = Number(raw ?? dflt);
  if (!Number.isFinite(n)) return dflt;
  return Math.min(2048, Math.max(8, Math.floor(n)));
}

function windowToLimit(win: WindowKey, bins: number): number {
  const base = bins * 2;
  if (win === "3h") return Math.max(360, base);
  if (win === "30m") return Math.max(120, base);
  return Math.max(180, base);
}

function klinesToPoints(kl: RawKline[]): MarketPoint[] {
  return (kl ?? []).map((row) => {
    const open = Number(row[0]);
    const close = Number(row[4]);
    const vol = Number(row[5]);
    return {
      ts: Number.isFinite(open) ? open : Date.now(),
      price: Number.isFinite(close) ? close : 0,
      volume: Number.isFinite(vol) ? vol : 0,
    };
  });
}

async function orderbookPoint(symbol: string): Promise<MarketPoint | null> {
  try {
    const ob = await fetchOrderBook(symbol, 50);
    if (Number.isFinite(ob.mid) && ob.mid! > 0) {
      const vol = (Number(ob.bidVol) || 0) + (Number(ob.askVol) || 0);
      return { ts: ob.ts ?? Date.now(), price: ob.mid!, volume: vol };
    }
  } catch (err) {
    console.warn("[str-aux] orderbookPoint failed", symbol, err);
  }
  return null;
}

async function loadPoints(symbol: string, win: WindowKey, bins: number): Promise<MarketPoint[]> {
  const limit = windowToLimit(win, bins);
  const points: MarketPoint[] = [];
  try {
    const kl = await fetchKlines(symbol, "1m", limit);
    points.push(...klinesToPoints(kl ?? []));
  } catch (err) {
    console.warn("[str-aux] fetchKlines failed", symbol, err);
  }
  const ob = await orderbookPoint(symbol);
  if (ob) points.push(ob);
  const seen = new Set<number>();
  const sorted = points
    .filter((p) => Number.isFinite(p.price) && p.price > 0)
    .sort((a, b) => a.ts - b.ts);
  const uniq: MarketPoint[] = [];
  for (const p of sorted) {
    if (seen.has(p.ts)) continue;
    seen.add(p.ts);
    uniq.push(p);
  }
  return uniq;
}

async function verifySymbolsMulti(symbols: string[], chunk = 200): Promise<Set<string>> {
  const ok = new Set<string>();
  for (let i = 0; i < symbols.length; i += chunk) {
    try {
      const slice = symbols.slice(i, i + chunk);
      const arr = await fetch24hAll(slice);
      for (const row of arr ?? []) {
        if (row?.symbol) ok.add(String(row.symbol).toUpperCase());
      }
    } catch (err) {
      console.warn("[str-aux] verify chunk failed", err);
    }
  }
  return ok;
}

function splitSymbol(sym: string): { base: string; quote: string } {
  const upper = sym.toUpperCase();
  const commons = ["USDT", "USD", "USDC", "BUSD", "EUR", "BTC", "ETH", "BRL"];
  for (const q of commons) {
    if (upper.endsWith(q)) {
      return { base: upper.slice(0, -q.length), quote: q };
    }
  }
  if (upper.length > 4) {
    return { base: upper.slice(0, upper.length - 4), quote: upper.slice(-4) };
  }
  return { base: upper, quote: "USDT" };
}

function percentOf(value: number | null, ref: number | null): number | null {
  if (!Number.isFinite(value) || !Number.isFinite(ref) || !ref) return null;
  return ((value! / ref!) - 1) * 100;
}

function deriveStreams(prices: number[], openingPrice: number | null) {
  if (!prices.length || !Number.isFinite(openingPrice) || !openingPrice) {
    return {
      benchmark: { prev: null, cur: null, greatest: null },
      pct_drv: { prev: null, cur: null, greatest: null },
    };
  }
  const benchSeries = prices.map((p) => percentOf(p, openingPrice) ?? 0);
  const drvSeries: number[] = [];
  for (let i = 1; i < prices.length; i++) {
    const prev = prices[i - 1];
    const cur = prices[i];
    if (Number.isFinite(prev) && Number.isFinite(cur) && prev > 0) {
      drvSeries.push(((cur / prev) - 1) * 100);
    }
  }
  const prevBench = benchSeries.length > 1 ? benchSeries[benchSeries.length - 2] : benchSeries[benchSeries.length - 1];
  const curBench = benchSeries[benchSeries.length - 1] ?? null;
  const prevDrv = drvSeries.length > 1 ? drvSeries[drvSeries.length - 2] : drvSeries[drvSeries.length - 1] ?? null;
  const curDrv = drvSeries.length ? drvSeries[drvSeries.length - 1] : null;
  const greatestBench = benchSeries.reduce((acc, v) => Math.max(acc, Math.abs(v)), 0);
  const greatestDrv = drvSeries.reduce((acc, v) => Math.max(acc, Math.abs(v)), 0);
  return {
    bench: { prev: prevBench ?? null, cur: curBench ?? null, greatest: greatestBench || null },
    drv: { prev: prevDrv ?? null, cur: curDrv ?? null, greatest: greatestDrv || null },
  };
}

function mapTickerBySymbol(rows: any[]): Record<string, any> {
  const map: Record<string, any> = {};
  for (const row of rows ?? []) {
    if (!row?.symbol) continue;
    map[String(row.symbol).toUpperCase()] = row;
  }
  return map;
}

async function computeSymbol(ctx: SymbolContext): Promise<CoinOut> {
  try {
    const points = await loadPoints(ctx.symbol, ctx.window, ctx.bins);
    if (!points.length) {
      return { ok: false, symbol: ctx.symbol, window: ctx.window, bins: ctx.bins, n: 0, lastUpdateTs: null, openingTs: null, error: "no_points" };
    }

    const sorted = points.sort((a, b) => a.ts - b.ts);
    const opening = sorted[0];
    const last = sorted[sorted.length - 1];
    const prev = sorted.length > 1 ? sorted[sorted.length - 2] : last;
    const prices = sorted.map((p) => p.price);

    const openingPrice = Number(opening?.price ?? NaN);
    const lastPrice = Number(last?.price ?? NaN);
    const prevPrice = Number(prev?.price ?? NaN);

    const benchSeries = prices.map((p) => percentOf(p, openingPrice) ?? 0);
    const benchPctMin = benchSeries.reduce((a, b) => Math.min(a, b), 0);
    const benchPctMax = benchSeries.reduce((a, b) => Math.max(a, b), 0);
    const priceMin = prices.reduce((a, b) => Math.min(a, b), prices[0]);
    const priceMax = prices.reduce((a, b) => Math.max(a, b), prices[0]);

    const drvSeries: number[] = [];
    for (let i = 1; i < prices.length; i++) {
      const prevP = prices[i - 1];
      const curP = prices[i];
      if (Number.isFinite(prevP) && prevP > 0) drvSeries.push(((curP / prevP) - 1) * 100);
    }
    const greatestDrvAbs = drvSeries.reduce((acc, v) => Math.max(acc, Math.abs(v)), 0);

    const ticker = ctx.ticker ?? null;
    const pct24h = ticker?.priceChangePercent != null ? Number(ticker.priceChangePercent) : null;
    const lastBenchPct = percentOf(lastPrice, openingPrice);
    const prevBenchPct = percentOf(prevPrice, openingPrice);
    const pctDrvCur = percentOf(lastPrice, prevPrice);
    const pctDrvPrev = percentOf(prevPrice, sorted.length > 2 ? sorted[sorted.length - 3]?.price ?? null : prevPrice);

    const fmRaw = computeFM(sorted.map(({ ts, price }) => ({ ts, price }) as any), { benchmark: openingPrice } as any, { totalBins: ctx.bins });
    const histRaw = computeIdhrBinsN(sorted.map(({ ts, price }) => ({ ts, price }) as any), { benchmark: openingPrice } as any, { totalBins: ctx.bins }, ctx.bins);

    const gfmPrice = Number.isFinite(openingPrice) ? openingPrice * Math.exp(fmRaw.gfm ?? 0) : null;
    const gfmDeltaPct = Number.isFinite(gfmPrice) && gfmPrice
      ? Math.abs(((lastPrice ?? gfmPrice) / gfmPrice) - 1) * 100
      : null;

    const nuclei = Array.isArray(fmRaw.nuclei)
      ? fmRaw.nuclei.map((n) => ({ binIndex: Number(n?.binIndex ?? 0) })).filter((n) => Number.isFinite(n.binIndex))
      : [];

    const { bench, drv } = deriveStreams(prices, openingPrice);

    return {
      ok: true,
      symbol: ctx.symbol,
      window: ctx.window,
      bins: ctx.bins,
      n: sorted.length,
      lastUpdateTs: Number(last?.ts ?? Date.now()),
      openingTs: Number(opening?.ts ?? last?.ts ?? Date.now()),
      cards: {
        opening: { benchmark: Number.isFinite(openingPrice) ? openingPrice : null, pct24h },
        live: {
          benchmark: Number.isFinite(lastPrice) ? lastPrice : null,
          pct24h,
          pct_drv: Number.isFinite(pctDrvCur ?? NaN) ? pctDrvCur ?? null : null,
        },
      },
      sessionStats: {
        priceMin: Number.isFinite(priceMin) ? priceMin : null,
        priceMax: Number.isFinite(priceMax) ? priceMax : null,
        benchPctMin: Number.isFinite(benchPctMin) ? benchPctMin : null,
        benchPctMax: Number.isFinite(benchPctMax) ? benchPctMax : null,
      },
      streams: {
        benchmark: {
          prev: Number.isFinite(prevBenchPct ?? NaN) ? prevBenchPct ?? null : null,
          cur: Number.isFinite(lastBenchPct ?? NaN) ? lastBenchPct ?? null : null,
          greatest: Math.max(Math.abs(benchPctMin), Math.abs(benchPctMax)) || null,
        },
        pct24h: {
          prev: pct24h,
          cur: pct24h,
          greatest: pct24h != null ? Math.abs(pct24h) : null,
        },
        pct_drv: {
          prev: Number.isFinite(pctDrvPrev ?? NaN) ? pctDrvPrev ?? null : null,
          cur: Number.isFinite(pctDrvCur ?? NaN) ? pctDrvCur ?? null : null,
          greatest: greatestDrvAbs || null,
        },
      },
      fm: {
        gfm_price: Number.isFinite(gfmPrice ?? NaN) ? gfmPrice : null,
        gfm_calc_price: Number.isFinite(gfmPrice ?? NaN) ? gfmPrice : null,
        gfm_ref_price: Number.isFinite(gfmPrice ?? NaN) ? gfmPrice : null,
        sigma: Number.isFinite(fmRaw.sigmaGlobal ?? NaN) ? (fmRaw.sigmaGlobal ?? 0) * 100 : null,
        zAbs: Number.isFinite(fmRaw.zMeanAbs ?? NaN) ? fmRaw.zMeanAbs ?? null : null,
        vInner: Number.isFinite(fmRaw.vInner ?? NaN) ? fmRaw.vInner ?? null : null,
        vOuter: Number.isFinite(fmRaw.vOuter ?? NaN) ? fmRaw.vOuter ?? null : null,
        inertia: Number.isFinite(fmRaw.inertia ?? NaN) ? fmRaw.inertia ?? null : null,
        disruption: Number.isFinite(fmRaw.disruption ?? NaN) ? fmRaw.disruption ?? null : null,
        nuclei,
      },
      hist: {
        counts: Array.isArray(histRaw.counts) ? histRaw.counts.map((c) => Number(c) || 0) : [],
        zStep: histRaw.edges?.length > 1 ? Math.abs(Number(histRaw.edges[1]) - Number(histRaw.edges[0])) : 0,
      },
      gfmDelta: {
        anchorPrice: Number.isFinite(gfmPrice ?? NaN) ? gfmPrice : null,
        price: Number.isFinite(lastPrice ?? NaN) ? lastPrice : null,
        absPct: Number.isFinite(gfmDeltaPct ?? NaN) ? gfmDeltaPct : null,
      },
      swaps: 0,
      shifts: 0,
      meta: { uiEpoch: Number(last?.ts ?? Date.now()) },
    };
  } catch (err: any) {
    return {
      ok: false,
      symbol: ctx.symbol,
      window: ctx.window,
      bins: ctx.bins,
      n: 0,
      lastUpdateTs: null,
      openingTs: null,
      error: String(err?.message ?? err),
    };
  }
}

function looksLikeSymbol(tokens: string[]): boolean {
  if (!tokens.length) return false;
  return tokens.every((t) => /^[A-Z0-9]{5,}$/i.test(t));
}

function normalizeTokens(tokens: string[]): string[] {
  return tokens
    .map((x) => String(x || "").trim().toUpperCase())
    .filter(Boolean);
}

export async function buildStrAuxBins(options: BuildOptions): Promise<StrAuxBinsResponse> {
  const ts = Date.now();
  const settings = await getSettings();
  const bases = (settings.coinUniverse ?? []).map((coin: string) => norm(coin)).filter(Boolean);
  const availability = await pairsFromSettings(bases, {
    verify: async (symbols) => verifySymbolsMulti(symbols),
    preferVerifiedUsdt: true,
  });

  const tokens = normalizeTokens(parseListParam(options.tokens));
  const allowUnverified = options.allowUnverified;
  const verified = new Set<string>(availability.all ?? []);
  const tokensAreSymbols = looksLikeSymbol(tokens);

  let symbols: string[] = [];
  if (!tokens.length) {
    symbols = availability.usdt.slice();
  } else if (tokensAreSymbols) {
    symbols = allowUnverified || !verified.size ? tokens.slice() : tokens.filter((s) => verified.has(s));
  } else {
    const legs = usdtLegsFromCoins(tokens);
    symbols = allowUnverified || !verified.size ? legs : legs.filter((s) => verified.has(s));
  }

  symbols = symbols.map((s) => s.toUpperCase());
  const uniqueSymbols = Array.from(new Set(symbols));

  const tickers = uniqueSymbols.length ? await fetch24hAll(uniqueSymbols) : [];
  const tickerBySymbol = mapTickerBySymbol(tickers ?? []);

  const tasks = uniqueSymbols.map(async (symbol) => {
    const result = await computeSymbol({ symbol, window: options.window, bins: options.bins, ticker: tickerBySymbol[symbol] });
    if (!result.ok && options.hideNoData) {
      return [symbol, result] as const;
    }
    return [symbol, result] as const;
  });

  const settled = await Promise.allSettled(tasks);
  const out: Record<string, CoinOut> = {};
  for (const s of settled) {
    if (s.status === "fulfilled") {
      const [symbol, val] = s.value;
      out[symbol] = val;
    }
  }

  const selected = uniqueSymbols.filter((sym) => out[sym]?.ok || !options.hideNoData);

  return {
    ok: true,
    ts,
    window: options.window,
    symbols: uniqueSymbols,
    out,
    available: availability,
    selected,
    timing: { 
      autoRefreshMs: Number(settings.timing?.autoRefreshMs ?? 0) || undefined,
      secondaryEnabled: Boolean(settings.timing?.secondaryEnabled ?? false),
      secondaryCycles: Number(settings.timing?.secondaryCycles ?? 0) || undefined,
    },
  };
}

export { loadPoints, splitSymbol };



