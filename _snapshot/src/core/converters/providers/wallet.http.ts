/* ----------------------------------------------------------------------------------
* 6) File: src/converters/providers/wallet.http.ts
* ---------------------------------------------------------------------------------- */

import type { WalletHttpProvider } from '@/core/converters/provider.types';

const DEFAULT_BASE = '/api/market/wallet';
const DEFAULT_ORIGIN =
  (typeof process !== 'undefined' && process.env.NEXT_PUBLIC_BASE_URL) ||
  'http://localhost:3000';

export function makeWalletHttpProvider(base = DEFAULT_BASE): WalletHttpProvider {
  return {
    async getWallet(symbol) {
      try {
        const origin = typeof window === 'undefined' ? DEFAULT_ORIGIN : window.location.origin;
        const url = new URL(base, origin);
        if (!url.pathname.startsWith('/')) {
          url.pathname = `/${url.pathname}`;
        }
        if (!url.searchParams.has('provider')) url.searchParams.set('provider', 'binance');

        const res = await fetch(url.toString(), { cache: 'no-store' });
        if (!res.ok) return 0;
        const payload = await res.json();
        const wallets = (payload?.wallets ?? {}) as Record<string, unknown>;
        const key = String(symbol ?? '').trim().toUpperCase();
        const val = Number(wallets[key]);
        return Number.isFinite(val) ? val : 0;
      } catch {
        return 0;
      }
    },
  } satisfies WalletHttpProvider;
}
