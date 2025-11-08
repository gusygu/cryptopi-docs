/**
 * core/features/cin-aux/db.ts
 * Thin pg Pool singleton for the CIN-AUX module.
 */
import { Pool } from "pg";
import type { DbConfig } from "./types";

let _pool: Pool | null = null;

export function getPool(cfg?: DbConfig): Pool {
  if (_pool) return _pool;
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL || cfg?.connectionString,
    host: process.env.PGHOST || cfg?.host,
    port: process.env.PGPORT ? Number(process.env.PGPORT) : cfg?.port,
    user: process.env.PGUSER || cfg?.user,
    password: process.env.PGPASSWORD || cfg?.password,
    database: process.env.PGDATABASE || cfg?.database,
    ssl: process.env.PGSSLMODE === "require" ? { rejectUnauthorized: false } : cfg?.ssl,
    max: 10,
    idleTimeoutMillis: 10_000,
  });
  _pool = pool;
  return pool;
}

export async function withTransaction<T>(fn: (client: any) => Promise<T>, cfg?: DbConfig): Promise<T> {
  const pool = getPool(cfg);
  const client = await pool.connect();
  try {
    await client.query(`SET lock_timeout = '15s'; SET statement_timeout = '10min';`);
    await client.query("BEGIN");
    const res = await fn(client);
    await client.query("COMMIT");
    return res;
  } catch (e) {
    try { await client.query("ROLLBACK"); } catch {}
    throw e;
  } finally {
    client.release();
  }
}