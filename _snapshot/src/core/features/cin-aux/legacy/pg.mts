import { Client, Pool, type PoolClient, type QueryResult } from "pg";

const DATABASE_URL = process.env.DATABASE_URL || "";
const DB_USER = process.env.DB_USER ?? "postgres";
const DB_PASSWORD = process.env.DB_PASSWORD ?? "gus";
const DB_HOST = process.env.DB_HOST ?? "localhost";
const DB_PORT = Number(process.env.DB_PORT ?? "1026");
const DB_NAME = process.env.DB_NAME ?? "cryptopi_dynamics";

let _pool: Pool | null = null;

export function getPool(): Pool {
  if (_pool) return _pool;
  if (DATABASE_URL) {
    _pool = new Pool({ connectionString: DATABASE_URL });
  } else {
    _pool = new Pool({
      user: DB_USER,
      host: DB_HOST,
      database: DB_NAME,
      password: DB_PASSWORD || undefined,
      port: DB_PORT,
      max: 8,
    });
  }
  return _pool;
}

export async function withClient<T>(fn: (c: PoolClient) => Promise<T>): Promise<T> {
  const pool = getPool();
  const client = await pool.connect();
  try {
    return await fn(client);
  } finally {
    client.release();
  }
}

export async function query<T = any>(text: string, params?: any[]): Promise<QueryResult<T>> {
  return withClient((c) => c.query<T>(text, params));
}

export async function tx<T>(fn: (c: PoolClient) => Promise<T>): Promise<T> {
  return withClient(async (c) => {
    await c.query("begin");
    try {
      const res = await fn(c);
      await c.query("commit");
      return res;
    } catch (e) {
      await c.query("rollback");
      throw e;
    }
  });
}
