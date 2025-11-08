type Kline = {
  openTime: number;  // ms
  open: string;
  high: string;
  low: string;
  close: string;
  volume: string;
  closeTime: number; // ms
};

const base = process.env.BINANCE_API_BASE ?? 'https://api.binance.com';
const defaultLimit = 1000;

export async function fetchKlines(params: {
  symbol: string;        // e.g. "BTCUSDT"
  interval: string;      // e.g. "1m", "5m"
  startTime?: number;    // ms
  endTime?: number;      // ms
  limit?: number;        // up to 1000
}): Promise<Kline[]> {
  const u = new URL('/api/v3/klines', base);
  u.searchParams.set('symbol', params.symbol);
  u.searchParams.set('interval', params.interval);
  if (params.startTime) u.searchParams.set('startTime', String(params.startTime));
  if (params.endTime) u.searchParams.set('endTime', String(params.endTime));
  u.searchParams.set('limit', String(params.limit ?? defaultLimit));

  const res = await fetch(u.toString(), { method: 'GET' });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Binance klines error ${res.status}: ${text}`);
  }

  // Binance returns array of arrays
  const raw = (await res.json()) as any[];
  return raw.map((r) => ({
    openTime: r[0],
    open: r[1],
    high: r[2],
    low: r[3],
    close: r[4],
    volume: r[5],
    closeTime: r[6],
  }));
}
