import { summarizeReport, type Report, type ReportItem } from '@/lib/types';
import { getSettingsServer } from '@/lib/settings/server';
import { fetchTickersForCoins, fetchOrderBooksForCoins } from '@/core/sources/binance';

const DEFAULT_COINS = 'BTC,ETH,BNB,ADA,SOL,USDT';

type OrderBookEntry = { mid?: number } & Record<string, unknown>;
type TickerEntry = Record<string, unknown>;

type HealthSnapshotBase = {
  ts: number;
  coins: string[];
  symbols: string[];
  counts: { tickers: number; orderbooks: number };
  echo: {
    coin: string;
    ticker: TickerEntry | null;
    orderbook: OrderBookEntry | null;
  };
  ok: boolean;
};

export type HealthSnapshot = HealthSnapshotBase & {
  echoAll?: Array<{ coin: string; ticker: TickerEntry | null; orderbook: OrderBookEntry | null }>;
};

export type HealthOptions = {
  includeAll?: boolean;
  coin?: string;
  depth?: number;
};

function normalizeCoins(raw?: string): string[] {
  return (raw ?? DEFAULT_COINS)
    .split(',')
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean);
}

export function buildStatusReport(now = Date.now()): Report {
  const coins = normalizeCoins(process.env.COINS);
  const pollerState = process.env.EMBED_POLLER === '1' ? 'running' : 'stopped';

  const items: ReportItem[] = [
    { key: 'feed:binance',  label: 'Binance feed',   level: 'ok',  value: true,      ts: now },
    { key: 'tickset:size',  label: 'Tickers loaded', level: coins.length ? 'ok' : 'warn', value: coins.length, ts: now },
    { key: 'poller:state',  label: 'Poller',         level: pollerState === 'running' ? 'ok' : 'warn', value: pollerState, ts: now },
    { key: 'latest:ts',     label: 'Latest tick ts', level: 'ok',  value: now - 60_000, ts: now },
  ];

  return {
    id: `status:${now}`,
    scope: 'aux',
    items,
    summary: summarizeReport(items),
    ts: now,
  };
}

function ensureUniverseCoins(coinsFromSettings?: string[]): string[] {
  const coins = (coinsFromSettings ?? []).map((c) => String(c || '').trim().toUpperCase()).filter(Boolean);
  const set = new Set(coins);
  if (!set.has('USDT')) {
    coins.push('USDT');
    set.add('USDT');
  }
  return coins;
}

export async function buildHealthSnapshot(opts: HealthOptions = {}): Promise<HealthSnapshot> {
  const now = Date.now();
  const depth = Number.isFinite(opts.depth) && Number(opts.depth) > 0 ? Number(opts.depth) : 20;
  const pick = (opts.coin ?? '').trim().toUpperCase();
  const includeAll = opts.includeAll ?? false;

  const { coinUniverse } = await getSettingsServer();
  const coins = ensureUniverseCoins(
    coinUniverse?.length
      ? coinUniverse
      : normalizeCoins(process.env.COINS ?? DEFAULT_COINS)
  );

  const [tickersRaw, booksRaw] = await Promise.all([
    fetchTickersForCoins(coins),
    fetchOrderBooksForCoins(coins, depth),
  ]);

  const tickers = tickersRaw as Record<string, TickerEntry | undefined>;
  const books = booksRaw as Record<string, OrderBookEntry | undefined>;

  const sampleCoin = coins.includes(pick) && pick !== 'USDT'
    ? pick
    : coins.find((c) => c !== 'USDT') ?? 'BTC';

  const sampleBook = books[sampleCoin];
  const hasMid = typeof sampleBook?.mid === 'number' && Number.isFinite(sampleBook.mid);

  const echo = {
    coin: sampleCoin,
    ticker: tickers[sampleCoin] ?? null,
    orderbook: sampleBook ?? null,
  };

  const snapshot: HealthSnapshot = {
    ts: now,
    coins,
    symbols: coins.filter((c) => c !== 'USDT').map((c) => `${c}USDT`),
    counts: { tickers: Object.keys(tickers).length, orderbooks: Object.keys(books).length },
    echo,
    ok: !!(echo.ticker && echo.orderbook && hasMid),
  };

  if (includeAll) {
    snapshot.echoAll = coins.map((c) => ({
      coin: c,
      ticker: tickers[c] ?? null,
      orderbook: books[c] ?? null,
    }));
  }

  return snapshot;
}
