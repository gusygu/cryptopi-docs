// src/core/poller/index.ts
import { Pool } from "pg";
import type { ScalesSettings } from "@/core/pipelines/types";
import { ServerPoller } from "./poller.server";
import { parseDuration } from "@/core/db/session";

const APP_SESSION_ID = process.env.APP_SESSION_ID ?? process.env.APP_SESSION ?? null;

type SettingsRow = {
  coinsCsv: string | null;
  scalesJson: any | null; // {cycle:"1m", continuous:{period:"1m"}, sampling?:..., window?:...}
  updatedAt: number;      // ms epoch
};

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.PGSSL === "true" ? { rejectUnauthorized: false } : undefined,
});

// ---- best-effort Settings loader (DB → fallback to env defaults) ----------------
async function loadSettings(appSessionId: string | null): Promise<{ coins: string[]; scales: ScalesSettings; stamp: string }> {
  const coinsEnv = (process.env.COINS ?? "BTC,ETH,BNB,SOL,ADA,XRP,DOGE,USDT")
    .split(",").map(s => s.trim()).filter(Boolean);

  const defaults: ScalesSettings = { cycle: "1m", continuous: { period: "1m" } };

  let row: SettingsRow | null = null;

  // Try a few well-known shapes. All queries are optional; we fall back silently.
  try {
    // 1) app_settings (preferred)
    const q1 = await pool.query(`
      select 
        coalesce(string_agg(distinct c.symbol, ','), null) as coins_csv,
        (select s.scales from public.app_settings s 
           where ($1::text is null or s.app_session_id=$1) 
           order by s.updated_at desc nulls last limit 1) as scales_json,
        extract(epoch from (now()))*1000 as updated_at
      from public.app_settings_coins c
      where ($1::text is null or c.app_session_id=$1)
    `, [appSessionId]);
    if (q1.rows?.[0]) {
      row = {
        coinsCsv: q1.rows[0].coins_csv,
        scalesJson: q1.rows[0].scales_json,
        updatedAt: q1.rows[0].updated_at ?? Date.now()
      };
    }
  } catch {}

  if (!row) {
    try {
      // 2) strategy_aux session doc (fallback if you keep scales/coins in that doc)
      const q2 = await pool.query(`
        select 
          coalesce((ts_doc->>'coins'), null) as coins_csv,
          (ts_doc->'scales') as scales_json,
          coalesce(ts_doc_ts, (extract(epoch from now())*1000)::bigint) as updated_at
        from public.str_aux_session
        where ($1::text is null or app_session=$1)
        order by ts_doc_ts desc nulls last, ts_ms desc nulls last
        limit 1
      `, [appSessionId]);
      if (q2.rows?.[0]) {
        row = {
          coinsCsv: q2.rows[0].coins_csv,
          scalesJson: q2.rows[0].scales_json,
          updatedAt: Number(q2.rows[0].updated_at) || Date.now()
        };
      }
    } catch {}
  }

  const coins = (row?.coinsCsv ?? coinsEnv.join(","))
    .split(",").map((s: string) => s.trim()).filter(Boolean);

  const rawScales = row?.scalesJson ?? defaults;
  const norm: ScalesSettings = normalizeScales(rawScales);

  const stamp = JSON.stringify({ coins, scales: norm, updatedAt: row?.updatedAt ?? Date.now() });
  return { coins, scales: norm, stamp };
}

function normalizeScales(x: any): ScalesSettings {
  const toMs = (v: any) => typeof v === "number" ? v : parseDuration(String(v ?? "1m"));
  const wrap = (v: any) => typeof v === "object" && v?.period ? v : { period: v };
  const cycle = x?.cycle ?? "1m";
  const out: ScalesSettings = {
    cycle,
    continuous: x?.continuous ? wrap(x.continuous) : { period: cycle },
    sampling:   x?.sampling   ? wrap(x.sampling)   : undefined,
    window:     x?.window     ? wrap(x.window)     : undefined,
  };
  // keep strings; PollHub already accepts string periods; it will parse/align.
  // (If you want all numbers here, convert: out.cycle = toMs(cycle); etc.)
  return out;
}

// ---- singleton poller with live-reload on Settings changes ---------------------
type LivePoller = {
  server: ServerPoller;
  stamp: string;   // JSON string of last settings snapshot
};
declare global {
   
  var __server_poller__: LivePoller | undefined;
}

async function buildServerPoller(): Promise<LivePoller> {
  const { scales, stamp } = await loadSettings(APP_SESSION_ID);
  const server = new ServerPoller({ scales, appSessionId: APP_SESSION_ID });
  server.start();
  return { server, stamp };
}

export async function getServerPoller(): Promise<ServerPoller> {
  if (!global.__server_poller__) {
    global.__server_poller__ = await buildServerPoller();
    // start a lightweight watcher that hot-reloads timings when Settings change
    startSettingsWatcher();
  }
  return global.__server_poller__!.server;
}

async function startSettingsWatcher() {
  const TICK_MS = 5_000; // adjust if you have NOTIFY handlers later
  const loop = async () => {
    try {
      const snap = await loadSettings(APP_SESSION_ID);
      if (!global.__server_poller__) return;
      if (snap.stamp !== global.__server_poller__.stamp) {
        // reload poller with new timings
        try { global.__server_poller__!.server.stop(); } catch {}
        const server = new ServerPoller({ scales: snap.scales, appSessionId: APP_SESSION_ID });
        server.start();
        global.__server_poller__ = { server, stamp: snap.stamp };
        // (coins changes are consumed by writers that re-read Settings on each run)
      }
    } catch {}
    setTimeout(loop, TICK_MS).unref?.();
  };
  setTimeout(loop, TICK_MS).unref?.();
}

// ---- tiny helper reused by jobs (reactive COINS) --------------------------------
export async function getActiveCoins(): Promise<string[]> {
  const { coins } = await loadSettings(APP_SESSION_ID);
  return coins;
}
