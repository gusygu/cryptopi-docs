import { Pool } from "pg";

let _pool: Pool | null = null;

export function getPool() {
  if (_pool) return _pool;
  const { DATABASE_URL } = process.env;
  if (!DATABASE_URL) {
    throw new Error("DATABASE_URL not set");
  }
  _pool = new Pool({ connectionString: DATABASE_URL });
  return _pool;
}

export async function withConn<T>(fn: (client: Pool) => Promise<T>) {
  const pool = getPool();
  return fn(pool);
}

export async function sql<T = unknown>(strings: TemplateStringsArray | string, ...values: any[]): Promise<T[]> {
  const text = Array.isArray(strings) ? strings.join("?") : strings;
  const pool = getPool();
  const res = await pool.query({ text, values });
  return res.rows as T[];
}

export async function runBatch(sqlText: string) {
  const pool = getPool();
  // split on unambiguous delimiters is brittle; just send whole file
  await pool.query(sqlText);
}
