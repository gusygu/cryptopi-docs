import { rm } from "node:fs/promises";
import { resolve } from "node:path";

const ROOT = resolve(process.cwd());
const TARGETS = [
  ".next/cache",
  ".next/types",
  "coverage",
  "docs",
  "reports",
  "tmp",
  "var/cache",
  process.env.DOC_ARTIFACT_DIR ?? "artifacts/docs",
].map((p) => resolve(ROOT, p));

export async function cleanupDocsAndArtifacts() {
  let removed = 0;
  for (const target of TARGETS) {
    try {
      await rm(target, { recursive: true, force: true });
      console.log(`[cleanup-docs] removed ${target}`);
      removed++;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.warn(`[cleanup-docs] skipped ${target}:`, message);
    }
  }
  console.log(`[cleanup-docs] completed (${removed} paths cleared)`);
}

if (process.argv[1]?.endsWith("cleanup-docs.mjs")) {
  cleanupDocsAndArtifacts()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error("[cleanup-docs] failed", err);
      process.exit(1);
    });
}
