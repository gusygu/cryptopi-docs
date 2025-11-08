import { buildPrimaryDirect, antisymmetrize, invertGrid } from "@/core/maths/math";

export async function smokeMatrices() {
  const coins = ["BTC", "ETH", "USDT"];
  const tmap = {
    BTCUSDT: { symbol: "BTCUSDT", weightedAvgPrice: "64000", priceChangePercent: "2.5" },
    ETHUSDT: { symbol: "ETHUSDT", weightedAvgPrice: "3200", priceChangePercent: "1.2" },
  };
  const primary = buildPrimaryDirect(coins, tmap);
  if (!primary.benchmark || primary.benchmark[0]?.[1] == null) {
    throw new Error("benchmark matrix missing BTC/ETH cell");
  }
  const inverse = invertGrid(primary.benchmark);
  const anti = antisymmetrize(primary.pct24h ?? []);
  console.log("[smoke-matrices] benchmark BTC/ETH", primary.benchmark[0][1]);
  console.log("[smoke-matrices] inverse ETH/BTC", inverse[1][0]);
  console.log("[smoke-matrices] pct antisym ETH/BTC", anti[1][0]);
}

if (process.argv[1]?.endsWith("matrices.mjs")) {
  smokeMatrices()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('[smoke-matrices] failed', err);
      process.exit(1);
    });
}
