#!/usr/bin/env node
import { Client } from 'pg';

async function main() {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    const appName    = process.env.APP_NAME    ?? 'cryptopi-dynamics';
    const appVersion = process.env.APP_VERSION ?? 'dev';
    const { rows } = await client.query('select ops.open_all_sessions($1,$2)', [appName, appVersion]);
    console.log('Stamped schemas count:', rows?.[0]?.open_all_sessions ?? '(ok)');
  } finally {
    await client.end();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
