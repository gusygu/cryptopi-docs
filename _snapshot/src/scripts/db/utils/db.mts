// src/scripts/utils/db.mts
import { Client } from 'pg';

function required(name: string, val?: string) {
  if (!val) throw new Error(`Missing env: ${name}`);
  return val;
}

export async function getClient() {
  const connectionString = required('DATABASE_URL', process.env.DATABASE_URL);
  const client = new Client({
    connectionString,
    statement_timeout: 30_000,
    application_name: 'cryptopi-smokes',
  });
  await client.connect();
  return client;
}
