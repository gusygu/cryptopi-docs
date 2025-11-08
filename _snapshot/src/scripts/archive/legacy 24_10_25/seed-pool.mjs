#!/usr/bin/env node
// scripts/seed-pool.mjs
// Idempotent pool seeder that:
// 1) Reads settings.coinUniverse
// 2) Upserts coin_universe + pairs rows for all symbols in the universe
// 3) Ensures minimal OHLCV backfill for each symbol (if --backfill)
// 4) Triggers calculators for id_pct and other matrices (if --calc)
//
// Assumptions (adapt to your repo):
// - Config lives at src/config/settings.js (ESM) exporting default { coinUniverse: string[], exchange: {...} }
// - DB is Postgres; connection string in process.env.DATABASE_URL
// - There are helper SQL functions or tables:
//   coin_universe(symbol PK, base, quote, is_active, discovered_at, meta jsonb)
//   pairs(symbol PK, base, quote, status, exchange, price_precision, qty_precision)
//   candles(symbol, timeframe, ts, open, high, low, close, volume) with unique(symbol, timeframe, ts)
// - Calculators are exposed from src/lib/calculators/index.js with runCalculators({ symbols, since })
//
// If your repo differs, just adjust import paths + SQL below.

import 'dotenv/config'
import minimist from 'minimist'
import ccxt from 'ccxt'
import { Client } from 'pg'

// ---------- CONFIG LOADING ----------
let settings
try {
  settings = (await import('../src/config/settings.js')).default
} catch (e) {
  console.error('[seed-pool] Could not load ../src/config/settings.js. Falling back to ENV.')
  settings = {
    coinUniverse: (process.env.COIN_UNIVERSE || 'BTCUSDT,ETHUSDT,SOLUSDT')
      .split(',')
      .map(s => s.trim())
      .filter(Boolean),
    exchange: { id: process.env.EXCHANGE_ID || 'binance', loadMarkets: true }
  }
}

const argv = minimist(process.argv.slice(2), {
  boolean: ['discover', 'backfill', 'calc', 'dry'],
  string: ['timeframe', 'since', 'quote'],
  default: {
    discover: true,
    backfill: true,
    calc: true,
    dry: false,
    timeframe: '1m',
    quote: 'USDT',
    // default backfill: last 24h
    since: () => Date.now() - 24 * 60 * 60 * 1000,
  }
})

const TIMEFRAME = argv.timeframe
const MIN_LOOKBACK_MS = 6 * 60 * 60 * 1000 // 6h minimal history for calculators gate (adjust as needed)
const SINCE = typeof argv.since === 'string' && /\d{4}-\d{2}-\d{2}/.test(argv.since)
  ? Date.parse(argv.since + 'T00:00:00Z')
  : (typeof argv.since === 'function' ? argv.since() : Number(argv.since) || Date.now() - 24*60*60*1000)

// ---------- EXCHANGE ----------
const ex = new ccxt[settings.exchange?.id || 'binance']({ enableRateLimit: true })
if (settings.exchange?.loadMarkets !== false) {
  await ex.loadMarkets()
}

// ---------- DB ----------
const pg = new Client({ connectionString: process.env.DATABASE_URL })
await pg.connect()

// ---------- UTIL ----------
const sleep = ms => new Promise(r => setTimeout(r, ms))
const nowISO = () => new Date().toISOString()

async function upsertUniverse(symbol, marketMeta = {}) {
  const { base = marketMeta.base, quote = marketMeta.quote } = marketMeta
  const meta = { ...marketMeta }
  if (argv.dry) {
    console.log('[dry][coin_universe] upsert', symbol, { base, quote, meta })
    return
  }
  await pg.query(
    `insert into coin_universe(symbol, base, quote, is_active, discovered_at, meta)
     values ($1, $2, $3, true, $4, $5)
     on conflict (symbol) do update set
       base = excluded.base,
       quote = excluded.quote,
       is_active = true,
       meta = coalesce(coin_universe.meta, '{}'::jsonb) || excluded.meta`,
    [symbol, base, quote, nowISO(), meta]
  )
}

async function upsertPair(symbol, marketMeta = {}) {
  const { base, quote, status = 'TRADING' } = marketMeta
  const exchange = settings.exchange?.id || 'binance'
  const price_precision = marketMeta.precision?.price ?? null
  const qty_precision = marketMeta.precision?.amount ?? null
  if (argv.dry) {
    console.log('[dry][pairs] upsert', symbol, { base, quote, status, exchange })
    return
  }
  await pg.query(
    `insert into pairs(symbol, base, quote, status, exchange, price_precision, qty_precision)
     values ($1, $2, $3, $4, $5, $6, $7)
     on conflict (symbol) do update set
       base = excluded.base,
       quote = excluded.quote,
       status = excluded.status,
       exchange = excluded.exchange,
       price_precision = excluded.price_precision,
       qty_precision = excluded.qty_precision`,
    [symbol, base, quote, status, exchange, price_precision, qty_precision]
  )
}

async function ensureBackfill(symbol, timeframe = TIMEFRAME, since = SINCE) {
  if (!argv.backfill) return
  const m = ex.markets[symbol] || ex.markets[symbol.replace('-', '/')] || null
  if (!m) {
    console.warn('[backfill] Market meta missing for', symbol)
    return
  }

  // Find the latest stored candle ts
  const { rows } = await pg.query(
    `select max(ts) as last_ts from candles where symbol = $1 and timeframe = $2`,
    [symbol, timeframe]
  )
  const lastTs = rows[0]?.last_ts ? Number(rows[0].last_ts) : null
  const start = lastTs ? lastTs + 1 : since

  if (Date.now() - (lastTs ?? since) < 60_000) {
    // already current enough
    return
  }

  console.log(`[backfill] ${symbol} ${timeframe} from ${new Date(start).toISOString()}`)

  if (argv.dry) return

  let cursor = start
  while (cursor < Date.now()) {
    try {
      const batch = await ex.fetchOHLCV(m.symbol, timeframe, cursor, 1000)
      if (!batch || !batch.length) break

      const values = []
      for (const [ts, o, h, l, c, v] of batch) {
        values.push(pg.query(
          `insert into candles(symbol, timeframe, ts, open, high, low, close, volume)
           values ($1,$2,$3,$4,$5,$6,$7,$8)
           on conflict (symbol, timeframe, ts) do nothing`,
          [symbol, timeframe, ts, o, h, l, c, v]
        ))
      }
      await Promise.all(values)

      cursor = batch[batch.length - 1][0] + ex.parseTimeframe(timeframe) * 1000
      await sleep(ex.rateLimit || 100)
    } catch (e) {
      console.error('[backfill][error]', symbol, e.message)
      await sleep(1000)
    }
  }
}

async function hasMinimumHistory(symbol, timeframe = TIMEFRAME, windowMs = MIN_LOOKBACK_MS) {
  const since = Date.now() - windowMs
  const { rows } = await pg.query(
    `select count(*)::int as n from candles where symbol=$1 and timeframe=$2 and ts >= $3`,
    [symbol, timeframe, since]
  )
  return rows[0]?.n > 0
}

async function runCalculators(symbols) {
  if (!argv.calc) return
  let calculators
  try {
    calculators = (await import('../src/lib/calculators/index.js'))
  } catch (e) {
    console.warn('[calc] calculators module not found, skipping. Expected src/lib/calculators/index.js')
    return
  }

  const ready = []
  for (const s of symbols) {
    const ok = await hasMinimumHistory(s)
    if (ok) ready.push(s)
    else console.log('[calc] skip (insufficient history):', s)
  }

  if (!ready.length) return
  if (argv.dry) {
    console.log('[dry][calc] would run for', ready)
    return
  }

  console.log('[calc] running for', ready)
  await calculators.runCalculators({ symbols: ready, since: SINCE })
}

function normalizeSymbol(sym, quote = argv.quote) {
  // Accept BTCUSDT, BTC/USDT, BTC-USDT -> return BTCUSDT
  if (!sym) return sym
  let s = sym.toUpperCase().replace('/', '').replace('-', '')
  // If no quote present and settings.quote provided, append
  if (!s.endsWith(quote)) return s
  return s
}

async function discoverFromExchange({ quote = argv.quote }) {
  if (!argv.discover) return []
  const out = []
  for (const id in ex.markets) {
    const m = ex.markets[id]
    if (!m.active) continue
    if (m.quote !== quote) continue
    const compact = `${m.base}${m.quote}`
    out.push({ symbol: compact, meta: m })
  }
  return out
}

async function main() {
  // Step 0: compose target set from settings + optional discovery
  const fromSettings = (settings.coinUniverse || []).map(s => normalizeSymbol(s))
  const discovered = await discoverFromExchange({ quote: argv.quote })
  const discoveredSymbols = new Set(discovered.map(d => d.symbol))

  const universe = Array.from(new Set([...fromSettings, ...discoveredSymbols]))
  if (!universe.length) {
    console.error('[seed-pool] No symbols resolved. Check settings.coinUniverse or use --discover')
    process.exit(1)
  }

  console.log('[seed-pool] symbols:', universe.join(','))

  // Step 1: upsert coin_universe + pairs
  for (const s of universe) {
    const m = ex.markets[`${s.slice(0, -4)}/${s.slice(-4)}`] || ex.markets[s] || null
    await upsertUniverse(s, m || { base: s.replace(/USDT$/, ''), quote: 'USDT' })
    await upsertPair(s, m || { base: s.replace(/USDT$/, ''), quote: 'USDT', status: 'TRADING' })
  }

  // Step 2: backfill each symbol
  for (const s of universe) {
    await ensureBackfill(s, TIMEFRAME, SINCE)
  }

  // Step 3: calculators
  await runCalculators(universe)

  console.log('[seed-pool] done.')
  await pg.end()
}

main().catch(async (e) => {
  console.error('[seed-pool][fatal]', e)
  try { await pg.end() } catch {}
  process.exit(1)
})
