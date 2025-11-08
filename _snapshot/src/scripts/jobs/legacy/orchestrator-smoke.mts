
import type { PipelineSettings, PollTick } from "../../../core/pipelines/types";
import { appendAppLedger } from "../../../core/db/pool_server";
import { runOrchestrator } from "../../../core/pipelines/pipeline";
import { getPool } from "../../../core/db/pool_server";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

(async () => {
  console.log("=== Orchestrator Smoke (2 cycles) ===");

  const settings: PipelineSettings = {
    matrices: {
      bases: ["BTC", "ETH", "BNB"],
      quote: "USDT",
      source: "binance",
      period: 1_000,
      persist: false,
    },
    scales: {
      cycle: { period: 1_000 },
    },
  };

  let cycles = 0;
  const targetCycles = 2;
  const periodMs =
    typeof settings.matrices.period === "number"
      ? settings.matrices.period
      : 1_000;

  const subscribe = async function* (): AsyncIterable<PollTick> {
    while (cycles < targetCycles) {
      const cycleTs = Date.now();
      yield {
        cycleTs,
        periodMs,
        appSessionId: null,
        scale: "cycle",
      };
      cycles += 1;
      await sleep(periodMs);
    }
  };

  await runOrchestrator(
    { settings, logger: console },
    {
      subscribe,
      onCycleDone: (tick) =>
        console.log("cycle done", { cycleTs: tick.cycleTs }),
    },
  );

  await appendAppLedger({
    topic: "smoke",
    event: "orchestrator",
    payload: { cycles: targetCycles },
    ts_epoch_ms: Date.now(),
  }).catch((err) => {
    console.warn("ledger append skipped:", (err as any)?.message ?? err);
  });

  console.log("Orchestrator smoke OK");
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
