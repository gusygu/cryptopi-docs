// src/scripts/jobs/binance-stream.ts
import WebSocket from "ws";
import { Client } from "pg";
import {
  persistLiveMatricesSlice,
  type MatrixGridObject,
} from "@/core/db/db";

// -------- settings readers --------
async function buildBinanceCombinedURL(pg: Client) {
  const { rows: syms } = await pg.query<{ symbol: string }>(
    `SELECT symbol
       FROM settings.coin_universe
      WHERE enabled = true
   ORDER BY sort_order NULLS LAST, symbol`
  );
  const { rows: wins } = await pg.query<{ window_label: string }>(
    `SELECT window_label
       FROM settings.windows
   ORDER BY 1`
  );

  const parts: string[] = [];
  for (const { symbol } of syms) {
    const s = symbol.toLowerCase();
    parts.push(`${s}@trade`);
    for (const { window_label } of wins)
      parts.push(`${s}@kline_${window_label.toLowerCase()}`);
  }
  if (!parts.length)
    throw new Error("No streams: settings.coin_universe/windows are empty.");
  return `wss://stream.binance.com:9443/stream?streams=${parts.join("/")}`;
}

async function ensureIngestTables(pg: Client) {
  const {
    rows: [r],
  } = await pg.query<{ ok: boolean }>(
    `
    SELECT bool_and(to_regclass(n) IS NOT NULL) AS ok
      FROM (VALUES ('ingest.ticker_raw'),('ingest.kline_raw')) t(n)
  `
  );
  if (!r?.ok)
    throw new Error("Missing ingest tables; run DDLs (24_ingest.sql).");
}

// -------- helpers to avoid NULLs --------
const toNum = (v: any): number | null => {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const nowMs = () => Date.now();
const symFromStream = (s: string) => s.split("@", 1)[0]?.toUpperCase();
const pickEventMs = (d: any) =>
  (toNum(d?.E) ?? toNum(d?.T) ?? toNum(d?.k?.T) ?? nowMs())!;
const pickPrice = (d: any) => d?.p ?? d?.c ?? d?.k?.c ?? null;
const pickQty = (d: any) => d?.q ?? d?.k?.v ?? null;
const pickMaker = (d: any) =>
  typeof d?.m === "boolean" ? d.m : null;

// -------- matrix persistence helpers --------
const MATRIX_FLUSH_MS = Number(process.env.MATRIX_FLUSH_MS ?? "5000");
const MATRIX_APP_SESSION =
  process.env.MATRIX_APP_SESSION ?? "binance-stream";

async function loadCoinUniverse(pg: Client): Promise<string[]> {
  const { rows } = await pg.query<{
    symbol: string | null;
    base_asset: string | null;
    quote_asset: string | null;
  }>(
    `SELECT symbol, base_asset, quote_asset, sort_order
       FROM settings.coin_universe
      WHERE enabled = true
   ORDER BY sort_order NULLS LAST, symbol`
  );

  const coins: string[] = [];
  const seen = new Set<string>();

  const push = (input: string | null | undefined) => {
    const coin = String(input ?? "").trim().toUpperCase();
    if (!coin || seen.has(coin)) return;
    seen.add(coin);
    coins.push(coin);
  };

  for (const row of rows) {
    const symbol = String(row.symbol ?? "").trim().toUpperCase();
    const base =
      row.base_asset && row.base_asset.trim().length
        ? row.base_asset
        : symbol.endsWith("USDT")
        ? symbol.slice(0, -4)
        : symbol;
    push(base);
    push(row.quote_asset);
  }

  if (seen.has("USDT")) {
    const idx = coins.indexOf("USDT");
    if (idx > 0) {
      coins.splice(idx, 1);
      coins.unshift("USDT");
    }
  } else {
    coins.unshift("USDT");
  }

  return coins;
}

async function buildBenchmarkGrid(
  pg: Client,
  coins: string[]
): Promise<MatrixGridObject> {
  const values: MatrixGridObject = {};
  if (!coins.length) return values;

  const prices = new Map<string, number>();
  prices.set("USDT", 1);

  const symbols = coins
    .filter((c) => c !== "USDT")
    .map((c) => `${c}USDT`);

  if (symbols.length) {
    const { rows } = await pg.query<{ symbol: string; price: string }>(
      `SELECT symbol, price
         FROM market.ticker_latest
        WHERE symbol = ANY($1::text[])`,
      [symbols]
    );
    for (const row of rows) {
      const symbol = String(row.symbol || "").toUpperCase();
      if (!symbol.endsWith("USDT")) continue;
      const base = symbol.slice(0, -4);
      const price = Number(row.price);
      if (!base || !Number.isFinite(price)) continue;
      prices.set(base, price);
    }
  }

  for (const base of coins) {
    values[base] = {};
    for (const quote of coins) {
      if (base === quote) continue;
      const pb = prices.get(base) ?? (base === "USDT" ? 1 : undefined);
      const pq = prices.get(quote) ?? (quote === "USDT" ? 1 : undefined);
      if (
        pb == null ||
        pq == null ||
        !Number.isFinite(pb) ||
        !Number.isFinite(pq) ||
        pq === 0
      ) {
        values[base][quote] = null;
      } else {
        values[base][quote] = pb / pq;
      }
    }
  }

  return values;
}

async function persistMatrices(pg: Client) {
  const coins = await loadCoinUniverse(pg);
  if (!coins.length) return;

  const benchmark = await buildBenchmarkGrid(pg, coins);
  const tsMs = Date.now();

  await persistLiveMatricesSlice({
    appSessionId: MATRIX_APP_SESSION,
    coins,
    tsMs,
    benchmark,
    idemPrefix: MATRIX_APP_SESSION,
  });
}

// -------- main job --------
export async function run() {
  const pg = new Client({ connectionString: process.env.DATABASE_URL! });
  await pg.connect();
  await ensureIngestTables(pg);

  const url = await buildBinanceCombinedURL(pg);
  console.log("[ws] url", url);

  const resubscribeSec = Number(process.env.RESUBSCRIBE_SEC ?? "60");

  let ws: WebSocket | null = null;
  let heartbeat: NodeJS.Timeout | null = null;
  let persistTimer: NodeJS.Timeout | null = null;
  let persistRunning = false;
  let pendingPersist = false;

  const startPersistLoop = () => {
    if (persistTimer) return;
    persistTimer = setInterval(async () => {
      if (!pendingPersist || persistRunning) return;
      persistRunning = true;
      pendingPersist = false;
      try {
        await persistMatrices(pg);
      } catch (err) {
        console.error("[ws] persist matrices error", err);
      } finally {
        persistRunning = false;
      }
    }, MATRIX_FLUSH_MS);
  };

  const stopPersistLoop = () => {
    if (persistTimer) {
      clearInterval(persistTimer);
      persistTimer = null;
    }
  };

  const markDirty = () => {
    pendingPersist = true;
    startPersistLoop();
  };

  const connect = () => {
    console.log("[ws] connecting.");
    ws = new WebSocket(url, { handshakeTimeout: 10_000 });

    ws.on("open", () => {
      console.log("[ws] open");
      // heartbeat: ping every 20s; require pong within 10s
      heartbeat && clearInterval(heartbeat);
      heartbeat = setInterval(() => {
        if (!ws || ws.readyState !== WebSocket.OPEN) return;
        let alive = false;
        ws.ping();
        const wait = setTimeout(() => {
          if (!alive) ws?.terminate();
        }, 10_000);
        ws.once("pong", () => {
          alive = true;
          clearTimeout(wait);
        });
      }, 20_000);

      markDirty();
    });

    ws.on("message", async (raw: WebSocket.RawData) => {
      const msg = JSON.parse(raw.toString()) as { stream: string; data: any };
      const stream = String(msg.stream);
      const data = msg.data;

      try {
        if (stream.endsWith("@trade")) {
          const symbol = (data?.s as string) || symFromStream(stream);
          if (!symbol) return;
          const lowerSym = symbol.toLowerCase();

          await pg.query(
            `INSERT INTO ingest.ticker_raw
              (symbol,event_time_ms,price,qty,is_buyer_maker,payload)
             VALUES ($1,$2,$3,$4,$5,$6)`,
            [
              lowerSym,
              pickEventMs(data),
              pickPrice(data),
              pickQty(data),
              pickMaker(data),
              data,
            ]
          );

          // optional normalized write:
          await pg.query(
            `SELECT market.apply_ticker_from_payload($1,$2)`,
            [lowerSym, data]
          );
        } else if (stream.includes("@kline_")) {
          const symbol = (data?.s as string) || symFromStream(stream);
          if (!symbol) return;
          const lowerSym = symbol.toLowerCase();
          const k = data?.k ?? {};
          const itv = String(
            k?.i || stream.split("@kline_")[1] || ""
          ).toLowerCase();
          const tOpen = toNum(k?.t);
          const tClose = toNum(k?.T);
          if (!itv || !tOpen || !tClose) return;

          await pg.query(
            `INSERT INTO ingest.kline_raw
               (symbol,interval_label,open_time_ms,close_time_ms,
                open_price,high_price,low_price,close_price,volume,trades,payload)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
             ON CONFLICT (symbol,interval_label,close_time_ms) DO NOTHING`,
            [lowerSym, itv, tOpen, tClose, k.o, k.h, k.l, k.c, k.v, k.n, data]
          );

          // optional normalized write:
          await pg.query(
            `SELECT market.apply_kline_from_payload($1,$2,$3)`,
            [lowerSym, itv, data]
          );
        }

        markDirty();
      } catch (e) {
        console.error("[ws] handle message error", e);
      }
    });

    ws.on("error", (e) => console.error("[ws] error", e));
    ws.on("close", () => {
      console.log("[ws] closed - will reconnect");
      heartbeat && clearInterval(heartbeat);
      stopPersistLoop();
      setTimeout(connect, Math.max(1000, resubscribeSec * 1000));
    });
  };

  connect();
}

if (import.meta.url === `file://${process.argv[1]}`) {
  run().catch((e) => {
    console.error("[ws] fatal", e);
    process.exit(1);
  });
}
