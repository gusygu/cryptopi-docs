/**
 * Feeds a mismatched tick to runOrchestrator and confirms it SKIPS (no fetch, no compute).
 *
 * PS:
 *   $env:TS_NODE_TRANSPILE_ONLY="1"; node -r ts-node/register -r tsconfig-paths/register `
 *   .\src\scripts\shards\orchestrator-skip.ts
 */
import { runOrchestrator } from "@/core/pipelines/pipeline";
import type { PipelineSettings, PollTick, Logger } from "@/core/pipelines/types";

const logger: Logger = {
  debug: (...a:any[]) => console.debug(...a),
  info:  (...a:any[]) => console.info(...a),
  warn:  (...a:any[]) => console.warn(...a),
  error: (...a:any[]) => console.error(...a),
};

const settings: PipelineSettings = {
  matrices: { bases: ["BTC","ETH"], quote: "USDT", source: "binance", period: "60s", persist: false, window: "1h" },
  scales:   { cycle: { period: "1m" } } // INTENTIONAL mismatch: 60s vs 1m (equal) → change to "59s" to see skip
};

// make it actually mismatch (e.g., tick=59s, cfg=60s)
const tick: PollTick = { cycleTs: Date.now(), periodMs: 59_000, scale: "cycle", reason: "manual" };

async function* oneTick() { yield tick; }

(async () => {
  console.info("[shard:orchestrator-skip] start");
  await runOrchestrator(
    { settings, logger },
    { subscribe: () => oneTick(), onCycleDone: () => console.log("[shard:orchestrator-skip] done") }
  );
  console.info("[shard:orchestrator-skip] end");
})().catch(e => { console.error("[shard:orchestrator-skip] error", e); process.exit(1); });
