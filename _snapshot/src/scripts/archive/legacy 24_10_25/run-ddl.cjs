// src/scripts/db/run-ddl.cjs
// Verbose DDL runner: applies SQL files statement-by-statement (no global tx).
// Prints the exact failing statement with context and error position.
//
// ENV:
//   DATABASE_URL  postgres://user:pass@host:port/db
//   DB_SCHEMA     (templating value for ${SCHEMA}, default: public)
//   DDL_DIR       dir of SQL files (default: src/db)
//   DDL_FILES     comma list of files (default: ddl.sql)

const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('❌ Missing env: DATABASE_URL');
  process.exit(2);
}

const DDL_DIR = process.env.DDL_DIR || 'src/db';
const DDL_FILES = (process.env.DDL_FILES || 'ddl.sql')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);

const DB_SCHEMA = process.env.DB_SCHEMA || 'public';
const DRY_RUN = process.env.DRY_RUN === '1';

function applyTemplate(s) {
  return s.replace(/\$\{SCHEMA\}/g, DB_SCHEMA);
}

// Simple SQL splitter that handles strings, dollar quotes, and comments.
function splitSqlStatements(sql) {
  const out = [];
  let i = 0, start = 0;
  let inS = false, inD = false, inDollar = false, dollarTag = null;
  let inLineC = false, inBlockC = false;

  const len = sql.length;
  while (i < len) {
    const c = sql[i], n = sql[i + 1];

    if (inLineC) {
      if (c === '\n') inLineC = false;
      i++; continue;
    }
    if (inBlockC) {
      if (c === '*' && n === '/') { inBlockC = false; i += 2; continue; }
      i++; continue;
    }
    if (!inS && !inD && !inDollar) {
      if (c === '-' && n === '-') { inLineC = true; i += 2; continue; }
      if (c === '/' && n === '*') { inBlockC = true; i += 2; continue; }
    }

    if (!inD && !inDollar && c === "'" ) { inS = !inS; i++; continue; }
    if (!inS && !inDollar && c === '"')  { inD = !inD; i++; continue; }

    if (!inS && !inD && c === '$') {
      // start or end of dollar-quote
      const m = /\$[A-Za-z0-9_]*\$/y;
      m.lastIndex = i;
      const tag = m.exec(sql);
      if (tag) {
        if (!inDollar) { inDollar = true; dollarTag = tag[0]; i += dollarTag.length; continue; }
        if (inDollar && dollarTag === tag[0]) { inDollar = false; dollarTag = null; i += tag[0].length; continue; }
      }
    }

    if (!inS && !inD && !inDollar && c === ';') {
      const stmt = sql.slice(start, i).trim();
      if (stmt) out.push(stmt);
      start = i + 1;
    }
    i++;
  }
  const tail = sql.slice(start).trim();
  if (tail) out.push(tail);
  return out;
}

// Pretty-print a caret under the error position within a statement.
function showErrorContext(stmt, posStr) {
  const pos = Number(posStr || 0);
  if (!pos || !Number.isFinite(pos)) {
    return stmt.length > 500 ? stmt.slice(0, 500) + '\n…' : stmt;
  }
  const idx = pos - 1; // pg gives 1-based index
  const prefix = stmt.slice(0, idx);
  const lineStart = prefix.lastIndexOf('\n') + 1;
  const lineEnd = stmt.indexOf('\n', idx);
  const end = lineEnd === -1 ? stmt.length : lineEnd;
  const line = stmt.slice(lineStart, end);
  const caret = ' '.repeat(idx - lineStart) + '^';
  const head = stmt.slice(Math.max(0, lineStart - 200), lineStart);
  const tail = stmt.slice(end, Math.min(stmt.length, end + 200));
  return `${head}${line}\n${caret}\n${tail}`;
}

(async () => {
  const client = new Client({ connectionString: DATABASE_URL });
  await client.connect();
  try {
    for (const f of DDL_FILES) {
      const filePath = path.join(DDL_DIR, f);
      if (!fs.existsSync(filePath)) throw new Error(`DDL file not found: ${filePath}`);
      const raw = fs.readFileSync(filePath, 'utf8');
      const sql = applyTemplate(raw);
      const stmts = splitSqlStatements(sql);
      console.log(`[DDL] ${f} — ${stmts.length} statements`);

      for (let idx = 0; idx < stmts.length; idx++) {
        const s = stmts[idx];
        const oneLine = s.replace(/\s+/g, ' ').slice(0, 120);
        console.log(`  ▶︎ [${idx+1}/${stmts.length}] ${oneLine}${oneLine.length===120?'…':''}`);
        if (DRY_RUN) continue;

        try {
          await client.query(s);
        } catch (e) {
          const msg = e && e.message ? e.message : String(e);
          const pos = e && e.position ? e.position : null;
          console.error(`\n❌ ERROR at statement ${idx+1}: ${msg}`);
          console.error(showErrorContext(s, pos));
          process.exit(2);
        }
      }
      console.log(`[DDL] ${f} ✅`);
    }
    console.log('[DDL] all done ✅');
  } finally {
    await client.end().catch(()=>{});
  }
})().catch(err => {
  console.error('❌ Runner error:', err?.message || err);
  process.exit(2);
});
