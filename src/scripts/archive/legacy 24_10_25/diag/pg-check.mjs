 
const { Client } = require("pg");
const url = process.env.DATABASE_URL;
const schema = (process.env.DB_SCHEMA || "public").replace(/"/g, "");

if (!url) {
  console.error("✖ DATABASE_URL is empty. Set it in .env");
  process.exit(1);
}

(async () => {
  console.log("[pg-check] DATABASE_URL =", url);
  const startedAt = Date.now();
  const c = new Client({ connectionString: url });
  try {
    await c.connect();
    await c.query(`set search_path to "${schema}", public;`);
    const who = await c.query("select current_user, inet_server_addr()::text as host, inet_server_port() as port, version()");
    const now = await c.query("select now()");
    console.log("✓ connected");
    console.table(who.rows);
    console.log("server_time:", now.rows[0].now);
    console.log("latency_ms:", Date.now() - startedAt);
    process.exit(0);
  } catch (e) {
    console.error("✖ connect error:", e.message || e);
    console.error("Hints:");
    console.error(" • Wrong password or user not allowed by pg_hba.conf");
    console.error(" • Password has special chars? URL-encode it in DATABASE_URL");
    console.error(" • SSL mismatch? Try adding ?sslmode=disable (if local)");
    process.exit(1);
  } finally {
    try { await c.end(); } catch {}
  }
})();
