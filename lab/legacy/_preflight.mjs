/* eslint-disable no-console */
import { Client } from "pg";

const base = process.env.BASE_URL || "http://localhost:3000";
const dburl = process.env.DATABASE_URL;
const schema = (process.env.DB_SCHEMA || "public").replace(/"/g, "");

async function checkServer() {
  try {
    const res = await fetch(`${base}/api/vitals/health`, { method: "GET" });
    await res.text();
    return res.ok;
  } catch {
    return false;
  }
}

async function checkDb() {
  if (!dburl) return false;
  const client = new Client({ connectionString: dburl });
  try {
    await client.connect();
    await client.query(`set search_path to "${schema}", public;`);
    await client.query("select 1");
    return true;
  } catch {
    return false;
  } finally {
    try { await client.end(); } catch {}
  }
}

(async () => {
  const sOk = await checkServer();
  const dOk = await checkDb();

  if (!sOk) console.error(`✖ server down at BASE_URL=${base} (run: pnpm dev)`);
  if (!dOk) console.error(`✖ DB unreachable with DATABASE_URL (check creds / server / pg_hba)`);

  if (!sOk || !dOk) process.exit(1);
  console.log("✓ preflight ok (server + db)");
})();
