// One-tick pipeline smoke with:
//  - ESM-safe loading of src/core/pipelines/pipeline.ts
//  - --discover N: fetch all USDT bases from Binance (optionally cap with --limit)
//
// Examples (PowerShell):
//  node --env-file=.env --loader ts-node/esm -r tsconfig-paths/register `
//    .\src\scripts\smokes\one-tick.cjs --discover 100 --quote USDT --period 1m --persist 1
//  node --env-file=.env --loader ts-node/esm -r tsconfig-paths/register `
//    .\src\scripts\smokes\one-tick.cjs --all --quote USDT --period 1m --persist 1 --limit 50

// NOTE: we use the ESM loader (--loader ts-node/esm). Do NOT add ts-node/register here.

const { fetchLiveSnapshot } = require('@/core/pipeline/source');
const path = require('path');
const { pathToFileURL } = require('url');

function flag(name){ return process.argv.includes(`--${name}`); }
function arg(name, def){ const i = process.argv.indexOf(`--${name}`); return (i>=0 && i+1<process.argv.length) ? process.argv[i+1] : def; }

const useAll      = flag('all');
const discoverArg = arg('discover', '');           // e.g. "100" to auto-build bases from Binance
const limitArg    = Number(arg('limit','0')) || 0; // optional cap
const basesArg    = arg('bases', process.env.BASES || 'BTC,ETH,ADA');
const quoteArg    = arg('quote', process.env.QUOTE || 'USDT');
const periodArg   = arg('period', process.env.MATRICES_PERIOD || '1m');
const persistArg  = arg('persist', process.env.MATRICES_PERSIST || '0');

const QUOTE   = String(quoteArg || 'USDT').trim();
const PERIOD  = String(periodArg || '1m').trim();
const PERSIST = /^(1|true)$/i.test(String(persistArg || '0'));

const logger = console;

function parsePeriod(s){
  if (typeof s === 'number') return s;
  const m = String(s).match(/^(\d+)(ms|s|m|h|d)$/i);
  if (!m) return 60_000;
  const v = Number(m[1]); const u = m[2].toLowerCase();
  if (u==='ms') return v;
  if (u==='s')  return v*1_000;
  if (u==='m')  return v*60_000;
  if (u==='h')  return v*3_600_000;
  if (u==='d')  return v*86_400_000;
  return 60_000;
}

async function basesFromSettings() {
  const { loadSettings } = require('@/core/settings');
  const st = await loadSettings();
  let bases = [...new Set((st.matrices?.bases || []).map(s => String(s).toUpperCase()))];
  if (limitArg > 0) bases = bases.slice(0, limitArg);
  return bases;
}

async function basesFromCli() {
  return basesArg.split(',').map(s => s.trim().toUpperCase()).filter(Boolean);
}

async function basesDiscoverUSDT(n) {
  // Discover via Binance exchangeInfo (Node 22 has fetch built-in)
  const url = 'https://api.binance.com/api/v3/exchangeInfo';
  const res = await fetch(url);
  if (!res.ok) throw new Error(`discover: http ${res.status}`);
  const data = await res.json();
  // Filter USDT-quoted, trading pairs; extract unique base assets
  const symbols = (data.symbols || []).filter(s => s.quoteAsset === 'USDT' && s.status === 'TRADING');
  let bases = [...new Set(symbols.map(s => String(s.baseAsset).toUpperCase()))];
  // Optionally sort by symbol count or just alpha; here alpha is fine for smoke
  bases.sort();
  if (n && Number.isFinite(+n) && +n > 0) bases = bases.slice(0, +n);
  if (limitArg > 0) bases = bases.slice(0, limitArg);
  return bases;
}

async function getBases() {
  if (discoverArg) return basesDiscoverUSDT(discoverArg);
  if (useAll)      return basesFromSettings();
  return basesFromCli();
}

// ESM-safe dynamic import of the TS file (handled by --loader ts-node/esm)
async function loadRunMatricesCycle() {
  const tsAbs = path.join(process.cwd(), 'src', 'core', 'pipelines', 'pipeline.ts');
  const mod = await import(pathToFileURL(tsAbs).href);
  const fn = (mod && (mod.runMatricesCycle || (mod.default && mod.default.runMatricesCycle)));
  if (!fn) throw new Error('runMatricesCycle not found in pipeline.ts');
  return fn;
}

(async () => {
  const BASES = await getBases();

  const settings = {
    matrices: { bases: BASES, quote: QUOTE, source: 'binance', period: PERIOD, persist: PERSIST, window: '1h' },
    scales:   { cycle: { period: PERIOD } } // align to avoid period-mismatch skips
  };

  const ms = parsePeriod(settings.matrices.period);
  const now = Date.now();
  const tick = { cycleTs: Math.floor(now/ms)*ms, periodMs: ms, appSessionId: null, reason: 'manual', scale: 'cycle' };

  console.info('[smoke:one-tick] cfg', {
    basesCount: settings.matrices.bases.length,
    sample: settings.matrices.bases.slice(0, 12),
    quote: settings.matrices.quote,
    period: settings.matrices.period,
    persist: settings.matrices.persist
  });

  const snapshot = await fetchLiveSnapshot(settings, tick, logger);

  const priceDirect = Object.keys(snapshot.priceBook.direct ?? {}).length;
  const priceUSDT   = Object.keys(snapshot.priceBook.usdt ?? {}).length;
  const priceOpen   = Object.keys(snapshot.priceBook.open24h ?? {}).length;
  const obCount     = Object.keys(snapshot.orderBooks ?? {}).length;
  const walCount    = Object.keys(snapshot.wallet ?? {}).length;

  console.info('[smoke:one-tick] snapshot:stats', { priceDirect, priceUSDT, priceOpen, orderBooks: obCount, walletAssets: walCount });

  const runMatricesCycle = await loadRunMatricesCycle();
  const res = await runMatricesCycle({ settings, logger }, tick, snapshot);

  const size = m => (m ? `${m.length}x${m[0]?.length ?? 0}` : '0x0');
  console.info('[smoke:one-tick] matrices:shapes', {
    nBases: res.bases.length,
    benchmark: size(res.matrices.benchmark),
    delta:     size(res.matrices.delta),
    pct24h:    size(res.matrices.pct24h),
    id_pct:    size(res.matrices.id_pct),
    pct_drv:   size(res.matrices?.pct_drv || undefined)
  });

  if (res.persisted) console.info('[smoke:one-tick] persisted', res.persisted);
  else               console.info('[smoke:one-tick] persist skipped (persist=false)');
})().catch(e => { console.error('[smoke:one-tick] error', e); process.exit(1); });
