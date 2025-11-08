import { getAccountBalances } from '@/core/sources/binanceAccount';

const BINANCE_EXCHANGEINFO = 'https://api.binance.com/api/v3/exchangeInfo';
const BINANCE_TICKER_24HR = 'https://api.binance.com/api/v3/ticker/24hr';

const mem = globalThis as unknown as {
  __binance_preview__?: {
    at: number;
    coins: string[];
    symbols: string[];
    spot?: boolean;
    quote?: string;
  };
};

const MAX_AGE_MS = 15 * 60 * 1000; // 15 minutes

const isLevToken = (sym: string) => /(?:UP|DOWN|BULL|BEAR)$/.test(sym) || /\d+[LS]$/.test(sym);

const norm = (s: string) => String(s || '').trim().toUpperCase();

export type PreviewCoinsOptions = {
  quote?: string;
  spotOnly?: boolean;
};

export type WalletSnapshot = {
  ok: boolean;
  provider: 'binance';
  wallets: Record<string, number>;
  warn?: string;
};

export async function getBinanceWalletBalances(email?: string): Promise<WalletSnapshot> {
  try {
    const wallets = await getAccountBalances(email ? { email } : undefined);
    return { ok: true, provider: 'binance', wallets };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'wallet fetch failed';
    return {
      ok: true,
      provider: 'binance',
      wallets: {},
      warn: message,
    };
  }
}

type PreviewSnapshot = {
  coins: string[];
  symbols: string[];
  cached: boolean;
  updatedAt: string;
  note?: string;
};

async function getPreviewSnapshot(opts: PreviewCoinsOptions = {}): Promise<PreviewSnapshot> {
  const quote = norm(opts.quote ?? '');
  const spotOnly = opts.spotOnly !== false;
  const cached = mem.__binance_preview__;

  if (
    cached &&
    Date.now() - cached.at < MAX_AGE_MS &&
    cached.spot === spotOnly &&
    (quote ? cached.quote === quote : !cached.quote)
  ) {
    return {
      coins: cached.coins,
      symbols: cached.symbols,
      cached: true,
      updatedAt: new Date(cached.at).toISOString(),
    };
  }

  const res = await fetch(BINANCE_EXCHANGEINFO, { cache: 'no-store' });
  if (!res.ok) {
    if (cached) {
      return {
        coins: cached.coins,
        symbols: cached.symbols,
        cached: true,
        updatedAt: new Date(cached.at).toISOString(),
        note: 'served from cache due to upstream error',
      };
    }
    throw new Error(`binance exchangeInfo ${res.status}`);
  }

  const data = (await res.json()) as { symbols?: Array<Record<string, unknown>> };
  const symbols = Array.isArray(data?.symbols) ? data.symbols : [];

  const set = new Set<string>();
  const symbolSet = new Set<string>();

  for (const entry of symbols) {
    const status = norm(entry?.status as string);
    if (status !== 'TRADING') continue;

    const isSpotAllowed = entry?.isSpotTradingAllowed ?? entry?.isSpotTradingAllowed === undefined;
    if (spotOnly && !isSpotAllowed) continue;

    const base = norm(entry?.baseAsset as string);
    const quoteAsset = norm(entry?.quoteAsset as string);
    const symbol = norm(entry?.symbol as string);

    const quoteMatches = quote ? quoteAsset === quote : true;

    if (base && !isLevToken(base) && quoteMatches) set.add(base);
    if (!quote && quoteAsset && !isLevToken(quoteAsset)) set.add(quoteAsset);

    if (
      quoteMatches &&
      base &&
      quoteAsset &&
      !isLevToken(base) &&
      !isLevToken(quoteAsset) &&
      symbol
    ) {
      symbolSet.add(symbol);
    }

    if (quote && quoteAsset === quote && base && !isLevToken(base)) {
      set.add(base);
    }
  }

  let coins = Array.from(set)
    .map((x) => x.replace(/[^A-Z0-9]/g, ''))
    .filter((x) => x.length >= 2 && x.length <= 10)
    .sort((a, b) => a.localeCompare(b));

  if (quote && quote.length && !isLevToken(quote)) {
    const sanitizedQuote = quote.replace(/[^A-Z0-9]/g, '');
    if (sanitizedQuote && !coins.includes(sanitizedQuote)) {
      coins = [sanitizedQuote, ...coins];
    }
  }

  const symbolList = Array.from(symbolSet)
    .map((x) => x.replace(/[^A-Z0-9]/g, ''))
    .filter((x) => x.length >= 5 && x.length <= 20)
    .sort((a, b) => a.localeCompare(b));

  mem.__binance_preview__ = {
    at: Date.now(),
    coins,
    symbols: symbolList,
    spot: spotOnly,
    quote: quote || undefined,
  };

  return {
    coins,
    symbols: symbolList,
    cached: false,
    updatedAt: new Date().toISOString(),
  };
}

export async function getBinancePreviewCoins(opts: PreviewCoinsOptions = {}) {
  const snapshot = await getPreviewSnapshot(opts);
  return snapshot;
}

export async function getBinancePreviewSymbols(opts: PreviewCoinsOptions = {}) {
  const snapshot = await getPreviewSnapshot(opts);
  return {
    symbols: snapshot.symbols,
    cached: snapshot.cached,
    updatedAt: snapshot.updatedAt,
    note: snapshot.note,
  };
}

export function symbolsFromCoins(coins: string[]): string[] {
  const out: string[] = [];
  const list = coins.map(norm).filter(Boolean);
  for (let i = 0; i < list.length; i++) {
    for (let j = 0; j < list.length; j++) {
      if (i === j) continue;
      out.push(`${list[i]}${list[j]}`);
    }
  }
  return Array.from(new Set(out));
}

export async function verifySymbolsWithBinance(candidates: string[], chunkSize = 160): Promise<string[]> {
  const ok: string[] = [];
  for (let i = 0; i < candidates.length; i += chunkSize) {
    const batch = candidates.slice(i, i + chunkSize);
    try {
      const url = `${BINANCE_TICKER_24HR}?symbols=${encodeURIComponent(JSON.stringify(batch))}`;
      const res = await fetch(url, { cache: 'no-store' });
      if (!res.ok) continue;
      const arr = (await res.json()) as Array<{ symbol?: string }>;
      for (const t of arr ?? []) if (t?.symbol) ok.push(norm(t.symbol));
      await new Promise((resolve) => setTimeout(resolve, 25));
    } catch {
      /* ignore failing chunk */
    }
  }
  return Array.from(new Set(ok));
}

