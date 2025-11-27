// core/lib/db.server.ts  (or wherever it lives)
import { Pool } from "pg";

declare global {
   
  var __pgPool__: Pool | undefined;
}

export function getPool(): Pool {
  if (!global.__pgPool__) {
    global.__pgPool__ = new Pool({
      connectionString: process.env.DATABASE_URL,
      max: 10,
    });
  }
  return global.__pgPool__;
}

export const db = {
  query: async <T = any>(text: string, params?: any[]) => {
    const pool = getPool();
    const res = await pool.query<T>(text, params);
    return res;
  },
};
