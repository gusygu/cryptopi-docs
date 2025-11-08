/**
 * Adapter-only smoke: hits Binance mirrors, prints counts. No DB, no math.
 *
 * Run (PowerShell):
 * $env:TS_NODE_TRANSPILE_ONLY="1"; node -r ts-node/register -r ./src/bootstrap/register-paths.ts --env-file=.env .\src\scripts\smokes\adapter.ts --bases BTC,ETH,ADA --quote USDT
 */

import { getSourceAdapter } from "@/core/pipelines/pipeline.api";
import type { PipelineSettings, PollTick, Logger } from "@/core/pipelines/types";

/* ---------- safe arg parsing ---------- */
function getArg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  const val = i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : undefined;
  return (val ?? process.env[name.toUpperCase()] ?? fallback).toString();
}

const basesArg: string = getArg("bases", "BTC,ETH,ADA");
const quoteArg: string = getArg("quote", "USDT");

const BASES = basesArg.split(",").map(s => s.trim()).filter(Boolean);
const QUOTE = quoteArg.trim();

const logger: Logger = console as any;

const settings: PipelineSettings = {
  matrices: { bases: BASES, quote: QUOTE, source: "binance", period: "1m", persist: false, window: "1h" },
  scales:   { cycle: { period: "1m" } }
};

const tick: PollTick = { cycleTs: Date.now(), periodMs: 60_000, scale: "cycle" };

async function main() {
  const adapter = getSourceAdapter(settings);
  console.info("[smoke:adapter] cfg", { bases: BASES, quote: QUOTE });

  const snap = await adapter.fetchLiveSnapshot(BASES, QUOTE, { tick, settings, logger });

  console.info("[smoke:adapter] price:direct", Object.keys(snap.priceBook.direct ?? {}).length);
  console.info("[smoke:adapter] price:usdt",   Object.keys(snap.priceBook.usdt ?? {}).length);
  console.info("[smoke:adapter] price:open24h",Object.keys(snap.priceBook.open24h ?? {}).length);
  console.info("[smoke:adapter] orderBooks",   Object.keys(snap.orderBooks ?? {}).length);
  console.info("[smoke:adapter] walletAssets", Object.keys(snap.wallet ?? {}).length);
}

main().catch((e) => {
  console.error("[smoke:adapter] error", e);
  process.exit(1);
});
