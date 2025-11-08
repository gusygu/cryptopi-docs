// src/scripts/jobs/docs-direct-write.mts
import 'dotenv/config';
import pkg from 'pg';

const { Pool } = pkg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function main() {
  const appSession = process.env.APP_SESSION_ID ?? 'dev-01';
  const domain = process.argv[2] ?? 'MEA';                  // allow override: e.g., pnpm job:docs:test-write -- MATRICES
  const nowMs = Date.now();

  const payload = {
    note: 'smoke insert',
    ts: nowMs,
    src: 'docs-direct-write.mts'
  };

  const sql = `
    INSERT INTO cycle_documents (domain, app_session_id, cycle_ts, pairs, rows, payload)
    VALUES ($1, $2, $3, $4, $5, $6)
    ON CONFLICT (domain, app_session_id, cycle_ts)
    DO UPDATE SET pairs = EXCLUDED.pairs, rows = EXCLUDED.rows, payload = EXCLUDED.payload
    RETURNING id, domain, app_session_id, cycle_ts, created_at
  `;

  const args = [domain, appSession, nowMs, 0, 0, payload];

  const c = await pool.connect();
  try {
    const r = await c.query(sql, args);
    const row = r.rows[0];
    console.log(`[docs] inserted/updated id=${row.id} domain=${row.domain} cycle_ts=${row.cycle_ts} at=${row.created_at}`);
  } finally {
    c.release();
  }
  await pool.end();
}

main().catch((e) => {
  console.error('[docs] insert error:', e.message);
  process.exit(1);
});
