// src/scripts/jobs/straux-seed-from-bins.mts
// Calls /api/str-aux/bins to stage snapshots (when STRAUX_SNAPSHOT_WRITE=1)
// and then inspects DB to confirm rows exist for APP_SESSION_ID.
//
// Usage:
//   APP_SESSION_ID=dev-01 STRAUX_SNAPSHOT_WRITE=1 pnpm run job:straux:seed
//
// Requires: app env for HTTP (pnpm dev running), and DB env for readback (dyn_app is enough)

import { getPool } from "legacy/pool";

const ORIGIN = process.env.ORIGIN || "http://localhost:3000";
const APP_SESSION_ID = (process.env.APP_SESSION_ID || "dev-01").slice(0, 64);
const COINS = (process.env.COINS || "BTC,ETH,SOL").toUpperCase();
const WINDOW = (process.env.WINDOW || "1h").toLowerCase();
const BINS = String(process.env.BINS || "64");

async function callBins() {
  const u = new URL("/api/str-aux/bins", ORIGIN);
  u.searchParams.set("sessionId", APP_SESSION_ID);
  u.searchParams.set("coins", COINS);
  u.searchParams.set("window", WINDOW);
  u.searchParams.set("bins", BINS);
  u.searchParams.set("allowUnverified", "true");
  const res = await fetch(u.toString(), { cache: "no-store" });
  const ok = res.ok;
  let body: any = null;
  try { body = await res.json(); } catch {}
  console.log("[seed] bins call", ok ? "OK" : `FAIL(${res.status})`, " symbols=", body?.symbols?.length ?? "—");
  if (!ok) {
    console.log("  error payload:", body);
  }
}

async function readStaging() {
  const pool = getPool();
  const c = await pool.connect();
  try {
    const r = await c.query(
      `select app_session_id, pair, win, created_at
         from public.strategy_aux_snapshots
        where app_session_id = $1
        order by created_at desc
        limit 5`,
      [APP_SESSION_ID]
    );
    console.log("[seed] staging rows (top 5):", r.rowCount);
    for (const row of r.rows) {
      console.log(`  ${row.pair}  win=${row.win}  at=${row.created_at}`);
    }
  } finally {
    c.release();
  }
}

async function main() {
  console.log(`[seed] STRAUX snapshot seeding  app_session=${APP_SESSION_ID}  origin=${ORIGIN}`);
  if ((process.env.STRAUX_SNAPSHOT_WRITE || "0") !== "1") {
    console.log("  STRAUX_SNAPSHOT_WRITE is not '1' — staging will be skipped by the route.");
  }
  await callBins();
  await readStaging();
}
main().catch(e => { console.error(e); process.exit(1); });
