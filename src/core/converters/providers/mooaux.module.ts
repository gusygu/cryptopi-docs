/* ----------------------------------------------------------------------------------
* 3) File: src/converters/providers/mooaux.module.ts
* ---------------------------------------------------------------------------------- */

import type { MooAuxProvider, Pair } from "@/core/converters/provider.types";

export type MooModuleDeps = {
  getMooForPair: (pair: Pair) => Promise<{ value: number; tier: string }>;
};

export function makeMooModuleProvider(deps: MooModuleDeps): MooAuxProvider {
  return {
    getMea(pair) {
      return deps.getMooForPair(pair);
    },
  } satisfies MooAuxProvider;
}
