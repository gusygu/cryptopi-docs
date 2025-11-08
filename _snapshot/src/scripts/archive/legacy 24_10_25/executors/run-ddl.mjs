// src/scripts/executors/run-ddl.mjs
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Pool } from 'pg';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);
const root = path.resolve(__dirname, '../../..');

function log(...a){ console.log('[run-ddl]', ...a); }
function err(...a){ console.error('[run-ddl]', ...a); }

async function exists(p){ try{ await fs.access(p); return true; } catch { return false; } }
async function read(p){ return fs.readFile(p, 'utf8'); }

function sanitize(raw, relPath){
  // Always remove role flips
  let txt = raw.split(/\r?\n/).filter(l =>
    !/^\s*set\s+role\b/i.test(l) &&
    !/^\s*reset\s+role\b/i.test(l)
  ).join('\n');

  // Allow full DDL inside patches/**
  const isPatch = /(^|[\\/])src[\\/ ]core[\\/]db[\\/]patches[\\/]/i.test(relPath);

  if (!isPatch) {
    // Only in non-patch files, strip unsafe ops specifically on str_aux_session.
    const rels = ['str_aux_session'];
    for (const rel of rels) {
      const reLine = new RegExp(
        String.raw`^.*\b(?:TRUNCATE|ALTER\s+TABLE|DROP\s+TABLE|GRANT\b.*\bON\s+TABLE|REVOKE\b.*\bON\s+TABLE)\b[^;]*\b${rel}\b[^;]*;?\s*$`,
        'gmi'
      );
      txt = txt.replace(reLine, `-- stripped unsafe op on ${rel} (non-patch)`);
      // Note: we no longer strip CREATE VIEW/SELECT statements.
    }
  }

  return txt;
}

async function listPatches(){
  const dir = path.join(root, 'src/core/db/patches');
  if (!(await exists(dir))) return [];
  const files = (await fs.readdir(dir))
    .filter(n => n.toLowerCase().endsWith('.sql'))
    .sort()
    .map(n => path.join(dir, n));
  return files;
}

async function resolveTargets(cli){
  if (cli.length) return cli.map(p => path.resolve(root, p));
  const candidates = [
    'src/core/db/ddl.sql',
    'src/core/db/ddl-aux.sql',
    'src/core/db/ddl-str.sql',
    'src/core/db/ddl-straux.sql',
    'src/core/db/ddl-cin.sql',
    'src/core/db/ddl-mea.sql',
    'src/scripts/db/ddl.sql',
    'src/scripts/db/ddl-aux.sql',
  ].map(p => path.resolve(root, p));
  const out = [];
  for (const f of candidates) if (await exists(f)) out.push(f);
  return out;
}

async function applyFile(pool, file){
  const rel = path.relative(root, file);
  const sql = sanitize(await read(file), rel);
  if (!sql.trim()) return;
  log('applying:', rel);
  await pool.query(sql);
  log('ok:', rel);
}

async function main(){
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) { err('DATABASE_URL not set'); process.exit(1); }
  const cli = process.argv.slice(2);

  const patches = await listPatches();
  const targets = await resolveTargets(cli);
  const files = [...patches, ...targets];
  if (!files.length){ err('no DDL files found'); process.exit(1); }

  log('connecting…');
  const pool = new Pool({ connectionString: dbUrl });
  try {
    for (const f of files) await applyFile(pool, f);
    log('ALL DONE ✅');
  } catch (e) {
    err('failure:', e?.message ?? e);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}
main();
