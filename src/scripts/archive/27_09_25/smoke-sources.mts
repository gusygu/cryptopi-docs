// src/scripts/smokes/smoke-sources.mts
// Probes external sources directly (Binance market + optional account balances)
// Usage: pnpm run smoke:sources

import { fetchTicker24h, fetch24hAll, fetchOrderBook, fetchKlines } from "@/core/sources/binance";
import { getAccountBalances } from "@/core/sources/binanceAccount";

function fmt(n: number | null | undefined) {
  if (!Number.isFinite(Number(n))) return "—";
  return Number(n).toFixed(6);
}
function ok(v: any) { return v !== null && v !== undefined; }

async function probeBinance() {
  const sym = process.env.SYMBOL || "BTCUSDT";
  console.log(`[binance] probing symbol=${sym}`);
  try {
    const t = await fetchTicker24h(sym);
    console.log("  24h.last   =", fmt((t as any)?.lastPrice), "  24h.pct =", fmt((t as any)?.priceChangePercent));
  } catch (e:any) {
    console.log("  24h error   :", e?.message || e);
  }
  try {
    const book = await fetchOrderBook(sym, 50);
    console.log("  orderbook   mid=", fmt(book?.mid), " ts=", book?.ts ?? "—");
  } catch (e:any) {
    console.log("  orderbook error:", e?.message || e);
  }
  try {
    const kl = await fetchKlines(sym, "1m", 50);
    const last = kl?.[kl.length - 1];
    const lastClose = Number(last?.[4] ?? NaN);
    console.log("  klines[1m]  n=", kl?.length ?? 0, " lastClose=", fmt(lastClose));
  } catch (e:any) {
    console.log("  klines error :", e?.message || e);
  }
  try {
    const arr = await fetch24hAll([sym, "ETHUSDT", "SOLUSDT"]);
    console.log("  24hAll      n=", arr?.length ?? 0);
  } catch (e:any) {
    console.log("  24hAll error:", e?.message || e);
  }
}

async function probeBalances() {
  console.log("[balances] probing account (optional)");
  try {
    const bal = await getAccountBalances();
    const keys = Object.keys(bal || {});
    const sample = keys.slice(0, 5).map(k => `${k}:${fmt((bal as any)[k])}`).join("  ");
    console.log("  coins:", keys.length, "  sample:", sample || "—");
  } catch (e:any) {
    console.log("  skipped / no creds or error:", e?.message || e);
  }
}

async function main() {
  await probeBinance();
  await probeBalances();
}
main().catch(e => { console.error(e); process.exit(1); });
