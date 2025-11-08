/**
 * CLI helper for syncing Binance symbols into the coin universe.
 *
 * Usage examples:
 *   pnpm admin:sync-symbols
 *   pnpm admin:sync-symbols --quote USDT --coins BTC,ETH,SOL
 *   pnpm admin:sync-symbols --all-market --keep
 *   pnpm admin:sync-symbols --json
 */

import "dotenv/config";
import { syncCoinUniverseFromBinance } from "@/core/features/markets/coin-universe";

type CliOptions = {
  quote?: string;
  coins?: string[];
  spotOnly?: boolean;
  disableMissing?: boolean;
  json?: boolean;
  silent?: boolean;
};

const toUpper = (value: string | null | undefined) =>
  String(value ?? "").trim().toUpperCase();

const parseArgs = (argv: string[]): CliOptions => {
  const options: CliOptions = {};

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i] ?? "";
    switch (token) {
      case "--quote": {
        const next = argv[i + 1];
        if (next) {
          options.quote = toUpper(next);
          i += 1;
        }
        break;
      }
      case "--coins": {
        const next = argv[i + 1];
        if (next) {
          options.coins = next
            .split(/[,\s]+/)
            .map((coin) => toUpper(coin))
            .filter(Boolean);
          i += 1;
        }
        break;
      }
      case "--spot-only":
      case "--spot":
        options.spotOnly = true;
        break;
      case "--all-market":
      case "--no-spot":
        options.spotOnly = false;
        break;
      case "--disable-missing":
        options.disableMissing = true;
        break;
      case "--keep":
        options.disableMissing = false;
        break;
      case "--json":
        options.json = true;
        break;
      case "--silent":
        options.silent = true;
        break;
      case "--help":
      case "-h":
        printHelp();
        process.exit(0);
        break;
      default: {
        if (token.startsWith("-")) {
          console.warn(`[sync-symbols] Ignoring unknown flag: ${token}`);
        }
        break;
      }
    }
  }

  return options;
};

const printHelp = () => {
  console.log(`Usage: pnpm admin:sync-symbols [options]

Options:
  --quote <asset>         Restrict to a specific quote asset (e.g., USDT)
  --coins <a,b,c>         Explicit list of base assets to sync
  --spot-only             Strict spot (default)
  --all-market            Include non-spot listings
  --disable-missing       Disable symbols missing from preview (default)
  --keep                  Do not disable missing symbols
  --json                  Output raw JSON payload
  --silent                Suppress friendly logs
  --help                  Show this message`);
};

async function main() {
  const argv = process.argv.slice(2);
  const flags = parseArgs(argv);

  const coins =
    flags.coins && flags.coins.length
      ? Array.from(new Set(flags.coins))
      : undefined;

  if (!flags.silent) {
    console.log(
      `[sync-symbols] Starting sync (quote=${flags.quote ?? "AUTO"}, spotOnly=${
        flags.spotOnly ?? true
      }, disableMissing=${flags.disableMissing ?? true}, coins=${
        coins ? coins.join(",") : "AUTO"
      })`
    );
  }

  const start = Date.now();
  const result = await syncCoinUniverseFromBinance({
    explicitCoins: coins,
    quote: flags.quote,
    spotOnly: flags.spotOnly ?? true,
    disableMissing: flags.disableMissing ?? true,
  });
  const durationMs = Date.now() - start;

  if (flags.json) {
    const payload = {
      ok: true,
      elapsedMs: durationMs,
      quote: flags.quote ?? null,
      spotOnly: flags.spotOnly ?? true,
      disableMissing: flags.disableMissing ?? true,
      coins: result.coins,
      symbols: result.symbols,
      inserted: result.inserted,
      updated: result.updated,
      disabled: result.disabled,
    };
    console.log(JSON.stringify(payload, null, 2));
    return;
  }

  if (!flags.silent) {
    console.log(
      `[sync-symbols] Sync complete in ${durationMs}ms :: coins=${result.coins.length} symbols=${result.symbols.length} rows=${result.rows.length}`
    );
    console.log(
      `[sync-symbols] delta :: inserted=${result.inserted} updated=${result.updated} disabled=${result.disabled}`
    );
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error("[sync-symbols] fatal:", error);
    process.exit(1);
  });
}
