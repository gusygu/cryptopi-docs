// Node 22+: global fetch exists

// import your modules (plural: pipelines/sources/* if that’s your structure)
import * as binance from "../../../core/sources/binance";
import * as binanceClient from "../../../core/sources/binanceClient";

const getCoins = binance.getSettingsCoinsHeadless ?? (async () => ["BTC","ETH","BNB","USDT"]);
const { fetchTickersForCoins, fetchKlines, fetchOrderBook, usdtSymbolsFor } = binance as any;

function ok(label: string, cond: any, extra?: any) {
  if (!cond) { console.error("FAIL:", label, extra ?? ""); process.exitCode = 1; }
  else { console.log("PASS:", label); }
}

(async () => {
  console.log("=== Binance Smoke ===");
  console.log("Base URL:", (binanceClient as any)?.BASE ?? "(unknown)");

  const coins = await getCoins();
  ok("coins non-empty", Array.isArray(coins) && coins.length > 0, coins);

  const tickers = await fetchTickersForCoins(coins);
  ok("tickers map object", !!tickers && typeof tickers === "object");

  const symbols = usdtSymbolsFor(coins);
  const sym = symbols.find((s: string) => s.endsWith("USDT"));
  ok("has USDT symbol", !!sym, symbols.slice(0, 10));

  if (sym) {
    const kl = await fetchKlines(sym, "1m", 10);
    ok("klines shape ok", Array.isArray(kl?.[0]) && kl[0].length >= 12, kl?.[0]);

    const ob = await fetchOrderBook(sym, 10);
    ok("orderbook mid finite", Number.isFinite(ob?.mid), { mid: ob?.mid });
  }

  if (process.exitCode === 1) process.exit(1);
  console.log("Binance smoke OK");
})().catch((e) => { console.error(e); process.exit(1); });
