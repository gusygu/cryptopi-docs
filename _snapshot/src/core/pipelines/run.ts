// src/core/pipelines/run.ts
import { runOrchestrator } from "./pipeline";
import type { PipelineSettings, ScalesSettings } from "./types";
import { PollHub } from "@/core/poller/scales";
import { loadSettings } from "@/core/settings";

function resolveScales(settings: PipelineSettings): ScalesSettings {
  const matricesPeriod = settings.matrices.period;
  const fallbackContinuousPeriod = typeof matricesPeriod === "number"
    ? Math.max(250, Math.floor(matricesPeriod / 4)) || matricesPeriod
    : "1s";

  return {
    continuous: settings.scales?.continuous ?? { period: fallbackContinuousPeriod },
    sampling: settings.scales?.sampling,
    cycle: settings.scales?.cycle ?? { period: matricesPeriod },
    window: settings.scales?.window,
  } satisfies ScalesSettings;
}

async function main() {
  const settings: PipelineSettings = await loadSettings();
  const scales = resolveScales(settings);
  const hub = new PollHub(scales, { appSessionId: null, label: "pipeline-cycle" });

  const stopHub = () => {
    hub.stop();
  };

  process.once("SIGINT", stopHub);
  process.once("SIGTERM", stopHub);

  hub.start();

  try {
    await runOrchestrator(
      { settings, logger: console },
      {
        subscribe: () => hub.subscribe("cycle"),
        onCycleDone: (t) => console.log("cycle done", t.cycleTs),
      }
    );
  } finally {
    stopHub();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
