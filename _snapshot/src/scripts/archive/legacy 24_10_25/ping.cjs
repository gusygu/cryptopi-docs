 
const { Client } = require("pg");

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("✖ DATABASE_URL is empty in your .env");
  process.exit(1);
}

(async () => {
  const started = Date.now();
  const c = new Client({ connectionString: url });
  try {
    await c.connect();
    const r = await c.query("select 1 as ok");
    const ms = Date.now() - started;
    const ok = r?.rows?.[0]?.ok === 1;
    console.log(ok ? `✓ db ping ok (${ms}ms)` : "✖ db ping failed");
    process.exit(ok ? 0 : 1);
  } catch (e) {
    console.error("✖ db ping error:", e.message || e);
    process.exit(1);
  } finally {
    try { await c.end(); } catch {}
  }
})();
