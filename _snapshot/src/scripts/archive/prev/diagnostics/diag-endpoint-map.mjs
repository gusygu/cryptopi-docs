// Compact endpoint → data-hints mapper
// Run: node src/scripts/smokes/diagnostics/diag-endpoint-map.mjs
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const COMPACT = process.env.SMOKE_COMPACT !== "0";

const CANDIDATES = [
  path.join(ROOT, "src", "app", "api"),
  path.join(ROOT, "app", "api"),
  path.join(ROOT, "pages", "api"),
];

const ENDS = ["route.ts","route.tsx","route.mts","route.js","route.mjs",".ts",".mts",".js",".mjs"];
const H = [
  "from 'pg'", 'from "pg"', "Pool(", "Client(",
  "from 'drizzle-orm'", 'from "drizzle-orm"',
  "from '@vercel/postgres'", 'from "@vercel/postgres"',
  "from '@prisma/client'", 'from "@prisma/client"',
  "query(", "sql`", "sql(", ".execute(", ".transaction(",
  "from '@/core/db", 'from "@/core/db', "getPool", "db.", "pool.", "client.", "database",
];

const walk = (d, acc=[]) => {
  if (!fs.existsSync(d)) return acc;
  for (const n of fs.readdirSync(d)) {
    const f = path.join(d, n);
    const s = fs.statSync(f);
    if (s.isDirectory()) walk(f, acc);
    else if (ENDS.some(e => f.endsWith(e))) acc.push(f);
  }
  return acc;
};

const toRoute = (f) => {
  let base = null;
  for (const b of CANDIDATES) if (f.startsWith(b + path.sep)) { base = b; break; }
  if (!base) return null;
  const rel = f.slice(base.length + 1).split(path.sep);
  if (base.endsWith(path.join("pages","api"))) {
    const p = rel.slice(1);
    let last = p.pop() || "";
    last = last.replace(/\.(t|j)sx?$/i,"").replace(/\.m(t|j)s$/i,"");
    return "/" + ["api", ...p, last].filter(Boolean).join("/");
  }
  if (rel.at(-1)?.startsWith("route.")) rel.pop();
  return "/" + ["api", ...rel].join("/");
};

const methods = (src) => {
  const rx = /export\s+async\s+function\s+(GET|POST|PUT|PATCH|DELETE|OPTIONS)\s*\(/g;
  const s = new Set(); let m; while ((m = rx.exec(src))) s.add(m[1]);
  return [...s];
};

const grep = (src) => H.filter((h) => src.includes(h));
const short = (p) => {
  // shorten long path: keep last 3 parts
  const parts = p.split(path.sep);
  return parts.slice(Math.max(0, parts.length - 3)).join(path.sep);
};

(async () => {
  const roots = CANDIDATES.filter(fs.existsSync);
  const files = roots.flatMap((r) => walk(r));
  const items = files.map((f) => {
    const code = fs.readFileSync(f, "utf8");
    const entry = {
      f: COMPACT ? short(path.relative(ROOT, f)) : path.relative(ROOT, f),
      r: toRoute(f),
      m: methods(code),
      h: grep(code).slice(0, 8),
    };
    if (!COMPACT) {
      entry.imports = [...code.matchAll(/from\s+['"]([^'"]+)['"]/g)].map((m) => m[1]).slice(0, 16);
    }
    return entry;
  });

  console.log(JSON.stringify({ at: new Date().toISOString(), compact: COMPACT, n: items.length, files: items }));
})().catch((e) => { console.error(e); process.exit(1); });
