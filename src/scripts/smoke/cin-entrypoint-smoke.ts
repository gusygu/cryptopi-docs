import "dotenv/config";
import { getAccountBalances } from "@/core/sources/binanceAccount";

async function main() {
  console.log("[cin-entrypoint] Checking Binance /api/v3/account…");
  const balances = await getAccountBalances().catch((err) => {
    console.error("[cin-entrypoint] Failed to reach Binance:", err);
    process.exitCode = 1;
    return null;
  });
  if (!balances) return;

  const entries = Object.entries(balances).filter(([, units]) => Number(units) > 0);
  console.log(
    `[cin-entrypoint] OK – ${Object.keys(balances).length} assets returned, ${entries.length} with non-zero balance.`,
  );
  console.table(
    entries
      .slice(0, 10)
      .map(([asset, units]) => ({ asset, units: Number(units).toFixed(6) })),
  );
}

void main();
