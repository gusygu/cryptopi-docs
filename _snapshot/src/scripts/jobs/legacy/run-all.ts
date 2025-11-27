#!/usr/bin/env tsx
 
import 'dotenv/config';

import { run as runWS } from './binance-stream';

async function main() {
  const { DATABASE_URL, RESUBSCRIBE_SEC = '30' } = process.env;
  if (!DATABASE_URL) {
    console.error('DATABASE_URL is required');
    process.exit(1);
  }

  console.log('[jobs] starting…');
  console.log('[jobs] RESUBSCRIBE_SEC =', RESUBSCRIBE_SEC);

  await runWS();                 // sets up WS + handlers
  setInterval(() => {}, 1 << 30); // keep the process alive
}

main().catch((e) => {
  console.error('[jobs] fatal', e);
  process.exit(1);
});
// pseudo-snippet
for (const file of ddlFiles) {
  const sql = fs.readFileSync(file, "utf8");
  await client.query("BEGIN");
  try {
    await client.query(sql);
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  }
}
