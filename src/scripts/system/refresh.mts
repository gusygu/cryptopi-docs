// src/scripts/system/refresh.mts
import "dotenv/config";
import yargs from "yargs";
import { hideBin } from "yargs/helpers";
import { runSystemRefresh } from "@/core/system/refresh";

type CliArgs = {
  symbols?: string;
  interval?: string;
  window?: string;
  poller?: string;
  telemetry: boolean;
  json: boolean;
};

const normalizeSymbols = (input?: string): string[] | undefined => {
  if (!input) return undefined;
  const parts = input
    .split(/[,\s]+/)
    .map((part) => part.trim().toUpperCase())
    .filter(Boolean);
  return parts.length ? parts : undefined;
};

async function main() {
  const argv = (await yargs(hideBin(process.argv))
    .scriptName("pnpm system:refresh")
    .option("symbols", {
      alias: "s",
      type: "string",
      describe: "Comma-separated list of symbols to refresh (e.g. BTCUSDT,ETHUSDT)",
    })
    .option("interval", {
      alias: "i",
      type: "string",
      describe: "Klines interval to ingest before deriving matrices (default 1m)",
    })
    .option("window", {
      alias: "w",
      type: "string",
      describe: "Analysis window label to use for openings (e.g. 30m, 1h)",
    })
    .option("poller", {
      alias: "p",
      type: "string",
      default: "cli",
      describe: "Poller identifier recorded in telemetry",
    })
    .option("telemetry", {
      type: "boolean",
      default: true,
      describe: "Whether to record poller_state telemetry",
    })
    .option("json", {
      type: "boolean",
      default: false,
      describe: "Output raw JSON only (useful for scripting)",
    })
    .help()
    .parse()) as CliArgs;

  const symbols = normalizeSymbols(argv.symbols);

  const result = await runSystemRefresh({
    symbols,
    klinesInterval: argv.interval,
    pollerId: argv.poller ?? "cli",
    recordTelemetry: argv.telemetry,
    window: argv.window,
  });

  if (argv.json) {
    console.log(JSON.stringify({ ok: result.ok, result }, null, 2));
  } else {
    console.log("system:refresh");
    console.log("  ok:", result.ok);
    console.log("  window:", argv.window ?? "1h");
    console.log("  symbols processed:", result.symbols.length);
    console.log("  duration (ms):", result.finishedAt - result.startedAt);
    for (const step of result.steps) {
      console.log(
        `    - ${step.name}: ${step.ok ? "ok" : "error"} (${step.durationMs}ms${
          step.error ? `, ${step.error}` : ""
        })`
      );
    }
  }

  if (!result.ok) {
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error("[system:refresh] failed:", err);
  process.exit(1);
});
