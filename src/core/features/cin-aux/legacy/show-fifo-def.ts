#!/usr/bin/env tsx
import "dotenv/config";
import { getPool } from "../../../db/client";

async function main() {
  const pool = getPool();
  try {
    const q = `
      SELECT pg_get_functiondef(p.oid) AS def
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'strategy_aux'
        AND p.proname = 'cin_consume_fifo_lots'
      ORDER BY p.oid DESC
      LIMIT 1;
    `;
    const { rows } = await pool.query(q);
    console.log(rows[0]?.def ?? "not found");
  } finally {
    await pool.end();
  }
}
main().catch(e => { console.error(e); process.exit(1); });
