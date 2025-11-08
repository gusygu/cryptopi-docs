#!/usr/bin/env node
/**
 * apply_cin_aux.mjs — Apply CryptoPill CIN-AUX SQL pack to PostgreSQL (no TS runtime needed)
 * Requires: node >= 18, npm i pg (or pnpm add pg / bun add pg)
 */
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import process from 'node:process';
import pg from 'pg';
const { Client } = pg;

function parseArgs(argv) {
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
  node apply_cin_aux.mjs [--file path/to/pack.sql]

Env:
  DATABASE_URL  (e.g., postgres://postgres:gus@localhost:1026/cryptopi_dynamics)
  or PGHOST, PGPORT, PGUSER, PGPASSWORD, PGDATABASE, PGSSLMODE
`;
}

function buildConnOpts() {
  const url = (process.env.DATABASE_URL || '').trim();
  if (url) {
    const sslMode = /[?&]sslmode=require\b/i.test(url);
    const sslEnv = (process.env.PGSSLMODE || '').toLowerCase() === 'require';
    return { connectionString: url, ssl: sslMode || sslEnv ? { rejectUnauthorized: false } : false };
  }
  const host = process.env.PGHOST || 'localhost';
  const port = +(process.env.PGPORT || 1026);
  const user = process.env.PGUSER;
  const password = process.env.PGPASSWORD;
  const database = process.env.PGDATABASE;
  if (!user || !database) {
    throw new Error('Set DATABASE_URL or PGUSER/PGPASSWORD/PGHOST/PGPORT/PGDATABASE');
  }
  const ssl = (process.env.PGSSLMODE || '').toLowerCase() === 'require' ? { rejectUnauthorized: false } : false;
  return { host, port, user, password, database, ssl };
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.help) {
    console.log(usage().trim());
    process.exit(0);
  }

  const sqlPath = resolve(process.cwd(), args.file);
  console.log(`==> Reading SQL: ${sqlPath}`);
  const sql = await readFile(sqlPath, 'utf8');

  const conn = buildConnOpts();
  const client = new Client(conn);

  try {
    await client.connect();
    await client.query(`SET lock_timeout = '15s'; SET statement_timeout = '10min';`);
    console.log('==> BEGIN');
    await client.query('BEGIN');
    await client.query(sql);
    await client.query('COMMIT');
    console.log('==> COMMIT — Done.');
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch {}
    console.error('!! Error applying SQL pack');
    if (err && err.position) console.error(`Position: ${err.position}`);
    console.error(err && err.message ? err.message : err);
    process.exitCode = 1;
  } finally {
    await client.end().catch(() => {});
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
