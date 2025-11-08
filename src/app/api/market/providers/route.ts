import { NextResponse } from 'next/server';

const PROVIDERS = [
  {
    id: 'binance',
    name: 'Binance',
    routes: {
      wallet: '/api/market/providers/binance/wallet',
      preview: '/api/market/providers/binance/preview',
      previewSymbols: '/api/market/providers/binance/preview/symbols',
      previewUniverse: '/api/market/providers/binance/preview/universe',
      previewUniverseSymbols: '/api/market/providers/binance/preview/universe/symbols',
      previewUniverseTicker: '/api/market/providers/binance/preview/universe/symbols/ticker',
      previewUniverseWallet: '/api/market/providers/binance/preview/universe/symbols/wallet',
      accountTest: '/api/market/providers/binance/account/test',
    },
  },
];

export async function GET() {
  return NextResponse.json({ providers: PROVIDERS, count: PROVIDERS.length }, {
    headers: { 'Cache-Control': 'no-store' },
  });
}
