import { rm } from "node:fs/promises";
import { resolve } from "node:path";

const ROOT = resolve(process.cwd());
const ARTIFACTS = [
  "str-aux.zip",
  "convsources.zip",
  "src/convsources",
  "lab/legacy/components.zip",
  "lab/legacy/convsources.zip",
  "lab/legacy/str-aux.zip",
  process.env.COLLATERAL_DIR ?? "var/collateral",
];

export async function cleanupCollateral() {
  let cleared = 0;
  for (const rel of ARTIFACTS) {
    const target = resolve(ROOT, rel);
    await rm(target, { recursive: true, force: true })
      .then(() => {
        console.log(`[cleanup-collateral] removed ${target}`);
        cleared++;
      })
      .catch((err) => {
        const message = err instanceof Error ? err.message : String(err);
        console.warn(`[cleanup-collateral] skipped ${target}:`, message);
      });
  }
  console.log(`[cleanup-collateral] completed (${cleared} paths cleared)`);
}

if (process.argv[1]?.endsWith("cleanup-collateral.mjs")) {
  cleanupCollateral()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error("[cleanup-collateral] failed", err);
      process.exit(1);
    });
}
