#!/usr/bin/env tsx
import "dotenv/config";
import { getPool } from "../../../db/client";

const SQL = `<<PASTE THE FUNCTION ABOVE>>`;

(async () => {
  const pool = getPool();
  try {
    await pool.query(SQL);
    console.log("cin_exec_move_v2: patched.");
  } finally {
    await pool.end();
  }
})().catch(e => { console.error(e); process.exit(1); });
