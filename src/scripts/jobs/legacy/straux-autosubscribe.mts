#!/usr/bin/env tsx
import pg from "pg";
import WebSocket from "ws";

// --- config
const DATABASE_URL = process.env.DATABASE_URL!;
const BINANCE_WS = "wss://stream.binance.com:9443/stream";

// keep a ws per symbol, so we can restart independently
const streams = new Map<string, WebSocket>();

async function getTargets(client: pg.Client): Promise<string[]> {
  const { rows } = await client.query(`select symbol from str_aux.v_ingest_targets`);
  return rows.map(r => r.symbol);
}

function wsParamsFor(symbol: string) {
  // kline 1s or bookTicker; choose one model; here we use bookTicker for mid
  return { method: "SUBSCRIBE", params: [`${symbol.toLowerCase()}@bookTicker`], id: Date.now() };
}

function ensureStream(symbol: string, client: pg.Client) {
  if (streams.has(symbol)) return;
  const ws = new WebSocket(BINANCE_WS);
  streams.set(symbol, ws);

  ws.on("open", () => ws.send(JSON.stringify(wsParamsFor(symbol))));
  ws.on("message", async (buf) => {
    try {
      const m = JSON.parse(String(buf));
      if (!m?.data?.s || !m?.data?.b || !m?.data?.a) return;
      const s = m.data.s;                      // SYMBOL
      const bid = Number(m.data.b), ask = Number(m.data.a);
      const mid = (bid + ask) / 2;

      // write one 5s-sample-equivalent: we only need core fields for flow
      await client.query(
        `select str_aux.upsert_sample_5s($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
        [
          s, new Date(),
          mid - 0.5, mid + 0.5, 0, 0,          // v_inner, v_outer, v_swap, v_tendency
          0, 0, 0, 0,                           // disruption, amp, volt, inertia
          0, 0, {}                              // modes, attrs
        ]
      );
      // cycles will roll via AFTER INSERT trigger; windows can be ticked periodically by a cron calling str_aux.tick_all()
    } catch { /* ignore burst parse errors */ }
  });

  ws.on("close", () => streams.delete(symbol));
  ws.on("error", () => { try { ws.close(); } catch {}; streams.delete(symbol); });
}

function dropStream(symbol: string) {
  const ws = streams.get(symbol);
  if (!ws) return;
  try { ws.close(); } catch {}
  streams.delete(symbol);
}

async function reconcile(client: pg.Client) {
  const should = new Set(await getTargets(client));
  // create missing
  for (const s of should) ensureStream(s, client);
  // drop extras
  for (const s of streams.keys()) if (!should.has(s)) dropStream(s);
}

async function main() {
  const client = new pg.Client({ connectionString: DATABASE_URL });
  await client.connect();

  // listen for universe changes
  await client.query(`listen settings_universe_changed`);
  client.on("notification", async (n) => {
    if (n.channel === "settings_universe_changed") {
      await reconcile(client);
    }
  });

  // initial reconcile
  await reconcile(client);

  // keep reconciling every 60s just in case
  setInterval(() => reconcile(client).catch(() => {}), 60_000);
}

main().catch((e) => { console.error(e); process.exit(1); });
