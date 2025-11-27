 
const fs = require("node:fs");
const path = require("node:path");

const envPath = path.resolve(process.cwd(), ".env");
if (!fs.existsSync(envPath)) {
  console.warn(`[env] .env not found at ${envPath} (skipping)`);
  return;
}

const raw = fs.readFileSync(envPath, "utf8");
// Strip UTF-8 BOM if present
const text = raw.charCodeAt(0) === 0xFEFF ? raw.slice(1) : raw;

for (const line of text.split(/\r?\n/)) {
  if (!line || /^\s*#/.test(line)) continue;
  const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
  if (!m) continue;
  let [, key, val] = m;

  // remove surrounding quotes if any
  if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
    val = val.slice(1, -1);
  }

  // keep first-set value; allow shell to override
  if (process.env[key] == null) process.env[key] = val;
}

console.log(`[env] loaded .env from ${envPath}`);
