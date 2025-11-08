// e.g. src/core/features/mea-aux/run.ts
import { buildMeaFromSettingsAndPairs } from "./build-from-sources";

export async function runMeaCycle({
  ts_ms,
  appSessionId,
  cycleTs,
  balances,
  getFrozenSet,
  rules,
  settingsAPI,
  marketAPI,
}: Parameters<typeof buildMeaFromSettingsAndPairs>[0]) {
  return await buildMeaFromSettingsAndPairs({
    ts_ms,
    appSessionId,
    cycleTs,
    balances,
    getFrozenSet,
    rules,
    settingsAPI,
    marketAPI,
  });
}
