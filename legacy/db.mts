#!/usr/bin/env node
import { runDbTool } from "../src/core/db/db";

runDbTool(process.argv.slice(2)).catch((err) => {
  console.error(err);
  process.exit(1);
});
