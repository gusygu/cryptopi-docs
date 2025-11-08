// src/scripts/smokes/diagnostics/diag-client-callers.mjs
// Run: node src/scripts/smokes/diagnostics/diag-client-callers.mjs
// Maps NON-API client files → which API endpoints they call (fetch/useSWR/axios)

import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const SRC = path.join(ROOT, "src");
const API_ROOTS = [path.join(SRC,"app","api"), path.join(ROOT,"app","api"), path.join(ROOT,"pages","api")];

const isApiPath = (p) => API_ROOTS.some(r => p.startsWith(r));
const exts = [".ts",".tsx",".mts",".js",".mjs"];

function walk(dir, acc=[]) {
  if (!fs.existsSync(dir)) return acc;
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    const st = fs.statSync(full);
    if (st.isDirectory()) walk(full, acc);
    else if (exts.some(e => full.endsWith(e))) acc.push(full);
  }
  return acc;
}

function findCalls(code) {
  const hits = [];
  // fetch('/api/...'), fetch("…", {method:'POST'})
  for (const m of code.matchAll(/fetch\(\s*['"]([^'"]+)['"]\s*(?:,\s*\{[^}]*method\s*:\s*['"]([A-Z]+)['"][^}]*\})?/g)) {
    if (m[1].includes("/api/")) hits.push({ ep: m[1], method: (m[2]||"GET").toUpperCase() });
  }
  // useSWR('/api/…')
  for (const m of code.matchAll(/useSWR\(\s*['"]([^'"]*\/api\/[^'"]+)['"]/g)) {
    hits.push({ ep: m[1], method: "GET", hook: "useSWR" });
  }
  // axios.get/post('/api/…')
  for (const m of code.matchAll(/axios\.(get|post|put|delete|patch)\(\s*['"]([^'"]*\/api\/[^'"]+)['"]/g)) {
    hits.push({ ep: m[2], method: m[1].toUpperCase(), lib: "axios" });
  }
  return hits;
}

(function main(){
  const files = walk(SRC).filter(f => !isApiPath(f));
  const items = [];
  for (const f of files) {
    const code = fs.readFileSync(f, "utf8");
    const calls = findCalls(code);
    if (calls.length) {
      // make endpoints relative (starts with /api)
      const norm = calls.map(c => ({
        ep: c.ep.includes("/api/") ? c.ep.slice(c.ep.indexOf("/api/")) : c.ep,
        m: c.method,
        h: c.hook, l: c.lib
      }));
      items.push({ f: path.relative(ROOT, f), calls: norm });
    }
  }
  console.log(JSON.stringify({ at:new Date().toISOString(), n: items.length, files: items }));
})();
