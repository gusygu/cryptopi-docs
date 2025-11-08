#!/usr/bin/env node
/**
 * apply_cin_aux.mts — Apply CryptoPill CIN-AUX DDL pack to PostgreSQL
 *
 * Usage:
 *   node apply_cin_aux.mts            # uses ./cin-aux-pack.sql by default
 *   node apply_cin_aux.mts -f path.sql
 *
 * Env:
 *   DATABASE_URL  (preferred)
 *   or PGHOST, PGPORT, PGUSER, PGPASSWORD, PGDATABASE, PGSSLMODE
 *
 * Behavior:
 *   - Single transaction (BEGIN...COMMIT; rollback on error)
 *   - Stops on first error (natural via PG error => rollback & exit 1)
 *   - Optional session settings: statement_timeout & lock_timeout
 *
 * Build/Run:
 *   npm i pg
 *   # Run with a loader that understands TS ESM, e.g. ts-node/tsx:
 *   npx tsx apply_cin_aux.mts -f cin-aux-pack.sql
 */

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import process from 'node:process';
import { Client } from 'pg';

type ConnOpts = {
  connectionString?: string;
  host?: string;
  port?: number;
  user?: string;
  password?: string;
  database?: string;
  ssl?: boolean | { rejectUnauthorized?: boolean };
};

function parseArgs(argv: string[]) {
  const args = { file: 'cin-aux-pack.sql', help: false };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '-h' || a === '--help') args.help = true;
    else if (a === '-f' || a === '--file') {
      if (!argv[i + 1]) throw new Error('Missing value for -f/--file');
      args.file = argv[++i];
    } else {
      throw new Error(`Unknown argument: ${a}`);
    }
  }
  return args;
}

function usage() {
  return `
Apply CryptoPill CIN-AUX SQL pack

Usage:
  npx tsx apply_cin_aux.mts [--file path/to/pack.sql]

Env:
  DATABASE_URL  (e.g., postgres://user:pass@host:5432/db)
  or PGHOST, PGPORT, PGUSER, PGPASSWORD, PGDATABASE, PGSSLMODE

Examples:
  export DATABASE_URL="postgres://user:pass@localhost:5432/cryptopill"
  npx tsx apply_cin_aux.mts -f cin-aux-pack.sql
`;
}

function buildConnOpts(): ConnOpts {
  const url = process.env.DATABASE_URL?.trim();
  if (url) {
    // Optional SSL handling for typical "sslmode=require"
    const sslMode = /[?&]sslmode=require\b/i.test(url);
    return { connectionString: url, ssl: sslMode || process.env.PGSSLMODE === 'require' };
  }
  const host = process.env.PGHOST || 'localhost';
  const port = +(process.env.PGPORT || 5432);
  const user = process.env.PGUSER;
  const password = process.env.PGPASSWORD;
  const database = process.env.PGDATABASE;
  if (!user || !database) {
    throw new Error('Set DATABASE_URL or PGUSER/PGPASSWORD/PGHOST/PGPORT/PGDATABASE');
  }
  const ssl = (process.env.PGSSLMODE === 'require') ? { rejectUnauthorized: false } : false;
  return { host, port, user, password, database, ssl };
}

async function main() {
  const { file, help } = parseArgs(process.argv);
  if (help) {
    console.log(usage().trim());
    process.exit(0);
  }

  const sqlPath = resolve(process.cwd(), file);
  console.log(`==> Reading SQL: ${sqlPath}`);
  const sql = await readFile(sqlPath, 'utf8');

  const conn = buildConnOpts();
  const client = new Client(conn);

  try {
    await client.connect();
    // Optional timeouts (session-level)
    await client.query(`SET lock_timeout = '15s'; SET statement_timeout = '10min';`);

    console.log('==> BEGIN');
    await client.query('BEGIN');

    // Execute the full pack as a single script. Any error will throw and rollback.
    await client.query(sql);

    await client.query('COMMIT');
    console.log('==> COMMIT — Done.');
  } catch (err: any) {
    try { await client.query('ROLLBACK'); } catch {}
    console.error('!! Error applying SQL pack');
    if (err?.position) {
      console.error(`Position: ${err.position}`);
    }
    console.error(err?.message || err);
    process.exitCode = 1;
  } finally {
    await client.end().catch(() => {});
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
