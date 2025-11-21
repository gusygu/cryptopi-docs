import { query } from "@/core/db/pool_server";

const DEFAULT_INTERVAL_MS = Number(process.env.STR_SAMPLER_WINDOW_ROLL_MS ?? 60_000);
const SPEC_LABEL = process.env.STR_SAMPLER_SPEC ?? "default";

let windowRollTimer: NodeJS.Timeout | null = null;

async function rollAllWindows() {
  try {
    await query(`select str_aux.try_roll_all_windows_now_for_all($1)`, [SPEC_LABEL]);
  } catch (err) {
    console.warn("[str-aux sampler] window roll failed:", err);
  }
}

export function startWindowRoller() {
  if (windowRollTimer) return;
  const interval = Math.max(15_000, DEFAULT_INTERVAL_MS);
  windowRollTimer = setInterval(() => {
    void rollAllWindows();
  }, interval);
  void rollAllWindows();
}
