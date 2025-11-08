// src/scripts/smokes/diagnostics/diag-api-sources.mjs
// Run: node --env-file=.env src/scripts/smokes/diagnostics/diag-api-sources.mjs
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const API_ROOTS = [path.join(ROOT,"src","app","api"), path.join(ROOT,"app","api"), path.join(ROOT,"pages","api")];
const ENDS = ["route.ts","route.tsx","route.mts","route.js","route.mjs",".ts",".mts",".js",".mjs"];

const DB_HINTS = [
  "from 'pg'", 'from "pg"', "Pool(", "Client(",
  "from 'drizzle-orm'", 'from "drizzle-orm"',
  "from '@vercel/postgres'", 'from "@vercel/postgres"',
  "from '@prisma/client'", 'from "@prisma/client"',
  "from '@/core/db", 'from "@/core/db',
  "getPool", "db.", "pool.", "client.", "query(", "sql`", "sql("
];

const SQL_BLOCK = /[`'"]([^`'"]*(?:select|update|insert|delete)\s+[^`'"]+?)['"`]/igs;
const TABLE_RX = /(?:from|join|into|update)\s+([a-z_]+\.[a-z_]+|[a-z_]+)/ig;

function walk(dir, acc=[]) {
  if (!fs.existsSync(dir)) return acc;
  for (const n of fs.readdirSync(dir)) {
    const f = path.join(dir, n);
    const s = fs.statSync(f);
    if (s.isDirectory()) walk(f, acc);
    else if (ENDS.some(e => f.endsWith(e))) acc.push(f);
  }
  return acc;
}

function toRoute(file) {
  let base = API_ROOTS.find(b => file.startsWith(b + path.sep));
  if (!base) return null;
  const rel = file.slice(base.length + 1).split(path.sep);
  if (base.endsWith(path.join("pages","api"))) {
    const p = rel.slice(1); let last = p.pop() || "";
    last = last.replace(/\.(t|j)sx?$/i,"").replace(/\.m(t|j)s$/i,"");
    return "/" + ["api", ...p, last].filter(Boolean).join("/");
  }
  if (rel.at(-1)?.startsWith("route.")) rel.pop();
  return "/" + ["api", ...rel].join("/");
}

function methods(src) {
  const rx = /export\s+async\s+function\s+(GET|POST|PUT|PATCH|DELETE|OPTIONS)\s*\(/g;
  const s = new Set(); let m; while ((m = rx.exec(src))) s.add(m[1]);
  return [...s];
}

function grepHints(src) { return DB_HINTS.filter(h => src.includes(h)); }

function pickSqlSamples(src, max=2) {
  const out = [];
  for (const m of src.matchAll(SQL_BLOCK)) {
    const sql = m[1].replace(/\s+/g," ").trim();
    if (!/(select|update|insert|delete)\s/i.test(sql)) continue;
    out.push(sql.slice(0, 220) + (sql.length>220? " …" : ""));
    if (out.length >= max) break;
  }
  return out;
}

function inferTables(sqls) {
  const set = new Set();
  for (const sql of sqls) {
    let m; while ((m = TABLE_RX.exec(sql))) {
      const t = m[1].replace(/["`]/g,"");
      if (/^[a-z_]+(\.[a-z_]+)?$/.test(t)) set.add(t);
    }
  }
  return [...set];
}

(function main(){
  const files = API_ROOTS.filter(fs.existsSync).flatMap(walk);
  const items = [];
  for (const f of files) {
    const code = fs.readFileSync(f,"utf8");
    const route = toRoute(f);
    if (!route) continue;
    const sqls = pickSqlSamples(code, 2);
    items.push({
      f: path.relative(ROOT, f),
      r: route,
      m: methods(code),
      hints: grepHints(code).slice(0,8),
      sql: sqls,
      tables: inferTables(sqls)
    });
  }
  console.log(JSON.stringify({ at:new Date().toISOString(), n: items.length, routes: items }));
})();
