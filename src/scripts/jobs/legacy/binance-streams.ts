import { Client, type PoolClient } from "pg";

import { resolveCoinUniverseSnapshot } from "@/core/features/markets/coin-universe";
import { run as runWebsocketStream } from "@/scripts/jobs/legacy/binance-stream";
import { getBinanceWalletBalances } from "@/core/api/market/binance";

type JobName = "ticker" | "klines" | "stream" | "balances" | "orderbook";

const DEFAULT_JOBS: JobName[] = ["ticker", "klines"];
const SUPPORTED_JOBS: JobName[] = [
  "ticker",
  "klines",
  "stream",
  "balances",
  "orderbook",
];

const DB_CONFIG = process.env.DATABASE_URL
  ? { connectionString: process.env.DATABASE_URL }
  : {
      host: process.env.PGHOST,
      port: process.env.PGPORT ? Number(process.env.PGPORT) : undefined,
      database: process.env.PGDATABASE,
      user: process.env.PGUSER,
      password: process.env.PGPASSWORD,
    };

type JobContext = {
  client: Client;
};

function parseJobs(argv: string[]): JobName[] {
  const jobs = argv
    .map((token) => token.trim().toLowerCase())
    .filter(Boolean) as JobName[];

  if (!jobs.length) return DEFAULT_JOBS;

  const invalid = jobs.filter((job) => !SUPPORTED_JOBS.includes(job));
  if (invalid.length) {
    throw new Error(`Unsupported job(s): ${invalid.join(", ")}`);
  }

  return jobs;
}

async function snapshotTicker(ctx: JobContext) {
  const { client } = ctx;
  console.log("[binance-streams:ticker] loading universe...");
  const snapshot = await resolveCoinUniverseSnapshot(client as unknown as PoolClient);
  const enabledSymbols = snapshot.rows
    .filter((row) => row.enabled)
    .map((row) => row.symbol);

  if (!enabledSymbols.length) {
    console.warn("[binance-streams:ticker] No symbols enabled; skipping.");
    return;
  }

  console.log(
    `[binance-streams:ticker] fetching ${enabledSymbols.length} symbols from Binance...`
  );
  const book = await fetch("https://api.binance.com/api/v3/ticker/bookTicker").then(
    (r) => r.json()
  );
  const bySymbol = new Map(book.map((entry: any) => [String(entry.symbol), entry]));

  await client.query("BEGIN");
  try {
    for (const symbol of enabledSymbols) {
      const ticker = bySymbol.get(symbol);
      if (!ticker) continue;

      const ts = new Date();
      const bid = Number(ticker.bidPrice);
      const ask = Number(ticker.askPrice);
      const bidQty = Number(ticker.bidQty);
      const askQty = Number(ticker.askQty);

      const price =
        Number.isFinite(bid) && Number.isFinite(ask)
          ? (bid + ask) / 2
          : Number.isFinite(bid)
          ? bid
          : Number.isFinite(ask)
          ? ask
          : Number(ticker.price ?? ticker.lastPrice ?? NaN);

      if (!Number.isFinite(price)) continue;

      const stats = {
        bidPrice: Number.isFinite(bid) ? bid : null,
        bidQty: Number.isFinite(bidQty) ? bidQty : null,
        askPrice: Number.isFinite(ask) ? ask : null,
        askQty: Number.isFinite(askQty) ? askQty : null,
        spread:
          Number.isFinite(bid) && Number.isFinite(ask) ? Number(ask) - Number(bid) : null,
      };

      await client.query(
        `
        INSERT INTO market.ticker_latest(symbol, ts, price, stats, meta)
        VALUES ($1,$2,$3,$4::jsonb,$5::jsonb)
        ON CONFLICT (symbol) DO UPDATE
          SET ts    = EXCLUDED.ts,
              price = EXCLUDED.price,
              stats = EXCLUDED.stats,
              meta  = EXCLUDED.meta
        `,
        [symbol, ts, price, JSON.stringify(stats), JSON.stringify(ticker)]
      );
    }
    await client.query("COMMIT");
    console.log("[binance-streams:ticker] snapshot complete.");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}

async function snapshotKlines(ctx: JobContext) {
  const { client } = ctx;
  console.log("[binance-streams:klines] loading universe...");
  const snapshot = await resolveCoinUniverseSnapshot(client as unknown as PoolClient);
  const symbols = snapshot.rows.filter((row) => row.enabled).map((row) => row.symbol);

  if (!symbols.length) {
    console.warn("[binance-streams:klines] No symbols enabled; skipping.");
    return;
  }

  const { rows: windows } = await client.query<{
    label: string;
  }>(`SELECT label FROM settings.windows ORDER BY ordinal_position`);

  console.log(
    `[binance-streams:klines] fetching klines for ${symbols.length} symbols across ${windows.length} windows.`
  );

  for (const symbol of symbols) {
    for (const { label } of windows) {
      const url = new URL("https://api.binance.com/api/v3/klines");
      url.searchParams.set("symbol", symbol);
      url.searchParams.set("interval", label);
      url.searchParams.set("limit", "500");

      const klines = await fetch(url.toString()).then((r) => r.json());
      if (!Array.isArray(klines)) continue;

      await client.query("BEGIN");
      try {
        for (const entry of klines) {
          const [openTime, open, high, low, close, volume, closeTime] = entry;
          await client.query(
            `
            INSERT INTO market.klines(symbol, window_label, open_time, close_time, open, high, low, close, volume)
            VALUES ($1,$2,to_timestamp($3/1000.0),to_timestamp($4/1000.0),$5,$6,$7,$8,$9)
            ON CONFLICT (symbol, window_label, open_time) DO NOTHING
            `,
            [symbol, label, openTime, closeTime, open, high, low, close, volume]
          );
        }
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }
    }
  }

  console.log("[binance-streams:klines] snapshots complete.");
}

async function streamLiveData() {
  console.log("[binance-streams:stream] delegating to binance-stream runner.");
  await runWebsocketStream();
}

async function captureWalletBalances() {
  console.log("[binance-streams:balances] fetching Binance balances (spot)...");
  const snapshot = await getBinanceWalletBalances();
  if (!snapshot.ok) {
    console.warn("[binance-streams:balances] No balances available.");
    return;
  }
  if (snapshot.warn) {
    console.warn(`[binance-streams:balances] warning: ${snapshot.warn}`);
  }
  const assetCount = Object.keys(snapshot.wallets ?? {}).length;
  console.log(`[binance-streams:balances] captured balances for ${assetCount} assets.`);
}

async function orderbookPlaceholder() {
  console.warn(
    "[binance-streams:orderbook] job not yet implemented. Future work: stream and persist orderbook depth."
  );
}

async function main(argv: string[]) {
  const jobs = parseJobs(argv);
  const needsDb = jobs.some((job) =>
    ["ticker", "klines", "orderbook"].includes(job)
  );

  let client: Client | null = null;

  try {
    if (needsDb) {
      client = new Client(DB_CONFIG as any);
      await client.connect();
    }

    const ctx: JobContext | null = client ? { client } : null;

    for (const job of jobs) {
      switch (job) {
        case "ticker":
          if (!ctx) throw new Error("Ticker job requires database connection.");
          await snapshotTicker(ctx);
          break;
        case "klines":
          if (!ctx) throw new Error("Klines job requires database connection.");
          await snapshotKlines(ctx);
          break;
        case "stream":
          await streamLiveData();
          break;
        case "balances":
          await captureWalletBalances();
          break;
        case "orderbook":
          if (!ctx) {
            console.warn(
              "[binance-streams:orderbook] skipped; database connection not available."
            );
            await orderbookPlaceholder();
          } else {
            await orderbookPlaceholder();
          }
          break;
        default:
          throw new Error(`Unhandled job: ${job}`);
      }
    }

    console.log("[binance-streams] completed.");
  } finally {
    if (client) {
      await client.end();
    }
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main(process.argv.slice(2)).catch((error) => {
    console.error("[binance-streams] fatal error", error);
    process.exit(1);
  });
}
