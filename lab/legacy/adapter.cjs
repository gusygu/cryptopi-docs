// Runs the Binance adapter only (no DB, no math).
// Usage (PowerShell):
//   node --env-file=.env .\src\scripts\smokes\adapter.cjs --bases BTC,ETH,ADA --quote USDT

require('ts-node/register/transpile-only');
require('tsconfig-paths/register');

const { getSourceAdapter } = require('@/core/pipelines/pipeline.api');

function arg(name, def) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : def;
}

const basesArg = arg('bases', process.env.BASES || 'BTC,ETH,ADA');
const quoteArg = arg('quote', process.env.QUOTE || 'USDT');

const BASES = basesArg.split(',').map(s => s.trim()).filter(Boolean);
const QUOTE = String(quoteArg || 'USDT').trim();

const settings = {
  matrices: { bases: BASES, quote: QUOTE, source: 'binance', period: '1m', persist: false, window: '1h' },
  scales:   { cycle: { period: '1m' } }
};

const tick = { cycleTs: Date.now(), periodMs: 60_000, scale: 'cycle' };
const logger = console;

(async () => {
  console.info('[smoke:adapter] cfg', { bases: BASES, quote: QUOTE });
  const adapter = getSourceAdapter(settings);
  const snap = await adapter.fetchLiveSnapshot(BASES, QUOTE, { tick, settings, logger });

  console.info('[smoke:adapter] price:direct', Object.keys(snap.priceBook.direct ?? {}).length);
  console.info('[smoke:adapter] price:usdt',   Object.keys(snap.priceBook.usdt ?? {}).length);
  console.info('[smoke:adapter] price:open24h',Object.keys(snap.priceBook.open24h ?? {}).length);
  console.info('[smoke:adapter] orderBooks',   Object.keys(snap.orderBooks ?? {}).length);
  console.info('[smoke:adapter] walletAssets', Object.keys(snap.wallet ?? {}).length);
})().catch(e => { console.error('[smoke:adapter] error', e); process.exit(1); });
