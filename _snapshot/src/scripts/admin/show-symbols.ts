import "dotenv/config";
import { resolveCoinUniverseSnapshot } from "@/core/features/markets/coin-universe";

type Options = { json?: boolean };

const parseArgs = (argv: string[]): Options => {
  const opts: Options = {};
  for (const token of argv) {
    switch (token) {
      case "--json":
        opts.json = true;
        break;
      case "--help":
      case "-h":
        printHelp();
        process.exit(0);
      default:
        if (token.startsWith("-")) {
          console.warn(`[show-symbols] Ignoring unknown flag: ${token}`);
        }
    }
  }
  return opts;
};

const printHelp = () => {
  console.log(`Usage: pnpm admin:show-symbols [--json]

Displays the current coin universe snapshot stored in settings.coin_universe.`);
};

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const snapshot = await resolveCoinUniverseSnapshot();
  const summary = {
    coins: snapshot.coins.length,
    symbols: snapshot.symbols.length,
    rows: snapshot.rows.length,
    coinsSample: snapshot.coins.slice(0, 12),
    symbolsSample: snapshot.symbols.slice(0, 12),
  };

  if (options.json) {
    console.log(
      JSON.stringify({ ok: true, summary, snapshot }, null, 2)
    );
    return;
  }

  console.log("[show-symbols] Current coin universe");
  console.table([
    { metric: "coins", value: summary.coins },
    { metric: "symbols", value: summary.symbols },
    { metric: "rows", value: summary.rows },
  ]);
  console.log(
    `[show-symbols] sample coins: ${summary.coinsSample.join(", ") || "(none)"}`
  );
  console.log(
    `[show-symbols] sample symbols: ${
      summary.symbolsSample.join(", ") || "(none)"
    }`
  );
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error("[show-symbols] fatal:", error);
    process.exit(1);
  });
}
