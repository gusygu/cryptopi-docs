// Small singleton Pool, friendly with pnpm/tsx
import { Pool } from 'pg';

let _pool: Pool | null = null;

export function getPool() {
  if (_pool) return _pool;
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('DATABASE_URL not set');
  }
  _pool = new Pool({ connectionString, max: 5, idleTimeoutMillis: 30_000 });
  return _pool;
}
