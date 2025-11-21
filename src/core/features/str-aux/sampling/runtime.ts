import { startSamplingUniverseWatcher } from "@/core/features/str-aux/sampling/universeWatcher";
import { startPersistenceLoop } from "@/core/features/str-aux/sampling/persistence";
import { startWindowRoller } from "@/core/features/str-aux/sampling/windowRoller";

let started = false;

export function ensureSamplingRuntime() {
  if (started) return;
  try {
    startSamplingUniverseWatcher();
  } catch (err) {
    console.warn("[sampling runtime] watcher start skipped:", err);
  }

  try {
    startPersistenceLoop();
  } catch (err) {
    console.warn("[sampling runtime] persistence start skipped:", err);
  }

  try {
    startWindowRoller();
  } catch (err) {
    console.warn("[sampling runtime] window roller start skipped:", err);
  }

  started = true;
}
