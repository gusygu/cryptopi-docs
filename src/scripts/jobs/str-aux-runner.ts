// src/scripts/jobs/str-aux-runner.ts
// Simple loop that runs the STR-AUX sampling + vector pipeline on an interval.

import { runStrAuxTick } from "@/core/features/str-aux/runner";
import { loadSettings } from "@/core/settings";
import type { PipelineSettings, PollTick } from "@/core/pipelines/types";

const INTERVAL_MS = Math.max(
  5_000,
  Number(process.env.STR_AUX_RUNNER_INTERVAL_MS ?? 40_000),
);
const SESSION_ID = process.env.STR_AUX_RUNNER_SESSION_ID ?? "str-aux-runner";

async function runOnce(settings: PipelineSettings) {
  const tick: PollTick = {
    ts: Date.now(),
    appSessionId: SESSION_ID,
  };
  await runStrAuxTick(settings, tick);
}

async function main() {
  console.log(
    `[str-aux-runner] booting with interval=${INTERVAL_MS}ms session=${SESSION_ID}`,
  );
  while (true) {
    const loopStarted = Date.now();
    try {
      const settings = await loadSettings();
      await runOnce(settings);
    } catch (err) {
      console.error("[str-aux-runner] tick failed:", err);
    }
    const elapsed = Date.now() - loopStarted;
    const waitFor = Math.max(1_000, INTERVAL_MS - elapsed);
    await new Promise((resolve) => setTimeout(resolve, waitFor));
  }
}

if ((import.meta as any).main) {
  main().catch((err) => {
    console.error("[str-aux-runner] fatal error:", err);
    process.exit(1);
  });
}
