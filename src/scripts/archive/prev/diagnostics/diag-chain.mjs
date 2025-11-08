// src/scripts/smokes/diagnostics/diag-chain.mjs
// Run: node --env-file=.env src/scripts/smokes/diagnostics/diag-chain.mjs
// Produces a chain: CLIENT FILE -> /api route -> API FILE -> tables + db hints

import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const SRC = path.join(ROOT, "src");
const API_ROOTS = [path.join(SRC,"app","api"), path.join(ROOT,"app","api"), path.join(ROOT,"pages","api")];
const exts = [".ts",".tsx",".mts",".js",".mjs"];

const DB_HINTS = [
  "from 'pg'", 'from "pg"', "Pool(", "Client(",
  "from 'drizzle-orm'", 'from "drizzle-orm"',
  "from '@vercel/postgres'", 'from "@vercel/postgres"',
  "from '@prisma/client'", 'from "@prisma/client"',
  "from '@/core/db", 'from "@/core/db',
  "getPool", "db.", "pool.", "client.", "query(", "sql`", "sql("
];
const SQL_RX = /(?:from|join|into|update)\s+([a-z_]+\.[a-z_]+|[a-z_]+)/ig;

function walk(dir, acc=[]) {
  if (!fs.existsSync(dir)) return acc;
  for (const n of fs.readdirSync(dir)) {
    const f = path.join(dir, n);
    const s = fs.statSync(f);
    if (s.isDirectory()) walk(f, acc);
    else if (exts.some(e => f.endsWith(e))) acc.push(f);
  }
  return acc;
}

function isApiPath(p) { return API_ROOTS.some(r => p.startsWith(r)); }

function toApiRoute(file) {
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

function findClientCalls(code) {
  const hits = [];
  for (const m of code.matchAll(/fetch\(\s*['"]([^'"]+)['"]\s*(?:,\s*\{[^}]*method\s*:\s*['"]([A-Z]+)['"][^}]*\})?/g)) {
    if (m[1].includes("/api/")) hits.push({ ep: m[1], m: (m[2]||"GET").toUpperCase() });
  }
  for (const m of code.matchAll(/useSWR\(\s*['"]([^'"]*\/api\/[^'"]+)['"]/g)) {
    hits.push({ ep: m[1], m: "GET", h: "useSWR" });
  }
  for (const m of code.matchAll(/axios\.(get|post|put|delete|patch)\(\s*['"]([^'"]*\/api\/[^'"]+)['"]/g)) {
    hits.push({ ep: m[2], m: m[1].toUpperCase(), l:"axios" });
  }
  return hits.map(x => ({ ep: x.ep.includes("/api/") ? x.ep.slice(x.ep.indexOf("/api/")) : x.ep, m:x.m, h:x.h, l:x.l }));
}

function grepHints(src) { return DB_HINTS.filter(h => src.includes(h)); }

function findTables(src) {
  const tables = new Set();
  for (const m of src.matchAll(/[`'"]([^`'"]*?\b(from|join|into|update)\b[^`'"]*?)['"`]/ig)) {
    const sql = m[1];
    let mm; while ((mm = SQL_RX.exec(sql))) {
      const t = mm[1].replace(/["`]/g,"");
      if (/^[a-z_]+(\.[a-z_]+)?$/.test(t)) tables.add(t);
    }
  }
  return [...tables].slice(0, 16);
}

(function main(){
  // map API route -> api file meta
  const apiFiles = walk(SRC).filter(isApiPath);
  const routeMap = new Map();
  for (const f of apiFiles) {
    const code = fs.readFileSync(f,"utf8");
    const route = toApiRoute(f);
    if (!route) continue;
    routeMap.set(route, {
      api_file: path.relative(ROOT, f),
      hints: grepHints(code).slice(0,8),
      tables: findTables(code),
    });
  }

  // scan client files
  const clientFiles = walk(SRC).filter(f => !isApiPath(f));
  const items = [];
  for (const f of clientFiles) {
    const code = fs.readFileSync(f,"utf8");
    const calls = findClientCalls(code);
    if (!calls.length) continue;
    const chain = calls.map(c => {
      const meta = routeMap.get(c.ep);
      return {
        ep: c.ep,
        m: c.m,
        via: meta ? {
          api: meta.api_file,
          hints: meta.hints,
          tables: meta.tables
        } : null
      };
    });
    items.push({ file: path.relative(ROOT, f), calls: chain });
  }

  console.log(JSON.stringify({ at: new Date().toISOString(), files: items }));
})();
