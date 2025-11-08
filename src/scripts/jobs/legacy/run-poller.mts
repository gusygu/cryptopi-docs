// Re-reads session settings → sets COINS for each cycle → spawns mat-refresh.mts.
// Usage: node --import tsx --env-file=.env src/scripts/run-poller.mts --every=60s
import { Pool } from "pg";
import { spawn } from "node:child_process";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const APP_SESSION = process.env.APP_SESSION_ID ?? "dev-01";

function parseEvery(s?: string): number {
  if (!s) return 60_000;
  const m = String(s).match(/^(\d+)(ms|s|m)?$/i);
  if (!m) return 60_000;
  const n = Number(m[1]);
  const unit = (m[2] ?? "ms").toLowerCase();
  if (unit === "ms") return n;
  if (unit === "s") return n * 1000;
  if (unit === "m") return n * 60_000;
  return 60_000;
}
const EVERY_MS = parseEvery(process.argv.find(a => a.startsWith("--every="))?.split("=")[1]);

type Json = any;

async function fetchSessionDoc(): Promise<Json | null> {
  // Try primary table
  try {
    const r = await pool.query(
      `select doc from public.str_aux_session where app_session = $1 order by ts_doc desc limit 1`,
      [APP_SESSION]
    );
    if (r.rows?.[0]?.doc) return r.rows[0].doc;
  } catch {}
  // Try view, if present
  try {
    const r2 = await pool.query(
      `select doc from public.v_str_aux_latest where app_session = $1 limit 1`,
      [APP_SESSION]
    );
    if (r2.rows?.[0]?.doc) return r2.rows[0].doc;
  } catch {}
  return null;
}

function tryArr(x: unknown): string[] | null {
  if (!x) return null;
  if (Array.isArray(x)) return x.map(String);
  return null;
}

function extractCoinsFromDoc(doc: Json): string[] | null {
  // Heuristic paths — we accept any of these shapes
  const paths = [
    ["settings", "matrices", "coins"],
    ["settings", "grid", "coins"],
    ["settings", "coins"],
    ["matrices", "coins"],
    ["grid", "coins"],
    ["coins"]
  ];
  for (const p of paths) {
    let cur: any = doc;
    for (const k of p) cur = cur?.[k];
    const arr = tryArr(cur);
    if (arr && arr.length) return arr.map(s => s.trim().toUpperCase()).filter(Boolean);
  }
  return null;
}

async function resolveCoins(): Promise<{ coins: string[]; source: "session" | "env" | "default" }> {
  const doc = await fetchSessionDoc();
  const fromDoc = doc ? extractCoinsFromDoc(doc) : null;
  if (fromDoc && fromDoc.length >= 2) return { coins: fromDoc, source: "session" };
  const fromEnv = (process.env.COINS ?? "")
    .split(",").map(s => s.trim().toUpperCase()).filter(Boolean);
  if (fromEnv.length >= 2) return { coins: fromEnv, source: "env" };
  return {
    coins: ["BTC", "ETH", "BNB", "SOL", "ADA", "XRP", "DOGE", "USDT"],
    source: "default"
  };
}

async function cycleOnce(iter: number) {
  const { coins, source } = await resolveCoins();
  const env = { ...process.env, COINS: coins.join(",") };
  const label = `[poller] #${iter} coins=${coins.join(",")} source=${source}`;
  console.log(`${label} — running mat-refresh…`);

  await new Promise<void>((res, rej) => {
    const ps = spawn(
      process.execPath, // node
      ["--import", "tsx", "--env-file=.env", "src/scripts/jobs/mat-refresh.mts"],
      { stdio: "inherit", env }
    );
    ps.on("exit", (code) => {
      if (code === 0) return res();
      return rej(new Error(`mat-refresh exit ${code}`));
    });
    ps.on("error", rej);
  });
  console.log(`${label} — done.`);
}

(async function main() {
  try {
    let i = 1;
    await cycleOnce(i++);
    const timer = setInterval(() => {
      cycleOnce(i++).catch(e => console.error("[poller] cycle error", e.message || e));
    }, EVERY_MS);
    process.on("SIGINT", async () => {
      console.log("\n[poller] stopping…");
      clearInterval(timer);
      await pool.end();
      process.exit(0);
    });
  } catch (e) {
    console.error("[poller] fatal", e);
    await pool.end();
    process.exit(1);
  }
})();
