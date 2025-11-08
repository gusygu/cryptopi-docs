#!/usr/bin/env tsx
import "dotenv/config";
import { applySqlFile } from "../../../db/fs-runner";

async function main() {
  try {
    await applySqlFile("src/core/db/00_cin_core.ddl.sql", "CIN DDL");
    await applySqlFile("src/core/db/01_cin_functions.sql", "CIN functions");
  } catch (err) {
    console.error("[apply-all] failure:", err);
    process.exit(1);
  }
}
main();
