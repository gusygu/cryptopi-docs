import { NextResponse } from 'next/server';

const SOURCES = [
  {
    id: 'binance-rest',
    provider: 'binance',
    label: 'Binance REST API',
    docs: 'https://binance-docs.github.io/apidocs/spot/en/',
    endpoints: {
      exchangeInfo: 'https://api.binance.com/api/v3/exchangeInfo',
      ticker24h: 'https://api.binance.com/api/v3/ticker/24hr',
      depth: 'https://api.binance.com/api/v3/depth',
    },
  },
];

export async function GET() {
  return NextResponse.json({ sources: SOURCES, count: SOURCES.length });
}
