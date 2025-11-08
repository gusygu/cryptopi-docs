import { NextResponse } from 'next/server';

export async function GET() {
  const ts = Date.now();
  return NextResponse.json({
    ok: true,
    ts,
    routes: {
      providers: '/api/market/providers',
      wallet: '/api/market/wallet',
      ticker: '/api/market/ticker',
      preview: '/api/preview',
      previewSymbols: '/api/preview/symbols',
      previewUniverse: '/api/preview/universe',
      previewUniverseSymbols: '/api/preview/universe/symbols',
      previewUniverseTicker: '/api/preview/universe/symbols/ticker',
      previewUniverseWallet: '/api/preview/universe/symbols/wallet',
      sources: '/api/market/sources',
    },
  }, { headers: { 'Cache-Control': 'no-store' } });
}
