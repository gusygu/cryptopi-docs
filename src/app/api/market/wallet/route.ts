import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { getBinanceWalletBalances } from '@/core/api/market/binance';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const PROVIDERS = new Set(['binance']);

const WALLET_DISABLED = (process.env.WALLET_ENABLED ?? '').toLowerCase() === 'false';

export async function GET(req: Request) {
  if (WALLET_DISABLED) {
    return NextResponse.json({ ok: false, error: 'wallet feature disabled' }, { status: 403 });
  }

  const url = new URL(req.url);
  const provider = (url.searchParams.get('provider') ?? 'binance').toLowerCase();

  if (!PROVIDERS.has(provider)) {
    return NextResponse.json({ ok: false, error: `unsupported provider: ${provider}` }, { status: 400 });
  }

  const jar = await cookies();
  const raw = jar.get('session')?.value ?? '';
  const email = raw.split('|')[0]?.trim().toLowerCase() || undefined;
  const snapshot = await getBinanceWalletBalances(email);
  return NextResponse.json(snapshot, { headers: { 'Cache-Control': 'no-store' } });
}



