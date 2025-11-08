// scripts/db-bootstrap.ts
import pg from "pg";

const sql = `
-- 1) core pair deltas
CREATE TABLE IF NOT EXISTS id_pct_pairs (
  base TEXT NOT NULL,
  quote TEXT NOT NULL,
  id_pct DOUBLE PRECISION NOT NULL,
  ts_epoch_ms BIGINT NOT NULL,
  PRIMARY KEY (base, quote, ts_epoch_ms)
);

CREATE OR REPLACE VIEW id_pct_latest AS
SELECT DISTINCT ON (base, quote)
  base, quote, id_pct, ts_epoch_ms
FROM id_pct_pairs
ORDER BY base, quote, ts_epoch_ms DESC;

-- 2) generic metrics bucket
CREATE TABLE IF NOT EXISTS metrics (
  metric_key TEXT NOT NULL,
  value DOUBLE PRECISION NOT NULL,
  ts_epoch_ms BIGINT NOT NULL,
  PRIMARY KEY (metric_key, ts_epoch_ms)
);

-- 3) balances + latest view
CREATE TABLE IF NOT EXISTS balances (
  asset TEXT NOT NULL,
  amount NUMERIC NOT NULL,
  ts_epoch_ms BIGINT NOT NULL,
  PRIMARY KEY (asset, ts_epoch_ms)
);

CREATE OR REPLACE VIEW wallet_balances_latest AS
SELECT DISTINCT ON (asset) asset, amount, ts_epoch_ms
FROM balances
ORDER BY asset, ts_epoch_ms DESC;

-- 4) availability (optional, harmless if unused)
CREATE TABLE IF NOT EXISTS pair_availability (
  base TEXT NOT NULL,
  quote TEXT NOT NULL,
  tradable BOOLEAN NOT NULL,
  ts_epoch_ms BIGINT NOT NULL,
  PRIMARY KEY (base, quote, ts_epoch_ms)
);
`;

async function run() {
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(sql);
    // seed a minimal snapshot so the API has something to read
    const now = Date.now();
    // balances
    await client.query(
      `INSERT INTO balances (asset, amount, ts_epoch_ms) VALUES
       ('USDT', 10000, $1), ('BTC', 1.2, $1), ('ETH', 12.5, $1), ('SOL', 350.0, $1)
       ON CONFLICT DO NOTHING`,
      [now]
    );
    // a few id_pct pairs (toy data)
    await client.query(
      `INSERT INTO id_pct_pairs (base, quote, id_pct, ts_epoch_ms) VALUES
       ('BTC','USDT', 0.9, $1),
       ('ETH','USDT', 0.6, $1),
       ('SOL','USDT', 1.1, $1),
       ('BTC','ETH',  0.3, $1),
       ('ETH','BTC', -0.4, $1),
       ('SOL','BTC',  1.2, $1),
       ('BTC','SOL',  0.8, $1),
       ('ETH','SOL',  0.2, $1),
       ('SOL','ETH', -0.1, $1)
       ON CONFLICT DO NOTHING`,
      [now]
    );
    // availability (all tradable)
    await client.query(
      `INSERT INTO pair_availability (base, quote, tradable, ts_epoch_ms) VALUES
       ('BTC','USDT', true, $1), ('ETH','USDT', true, $1), ('SOL','USDT', true, $1),
       ('BTC','ETH',  true, $1), ('ETH','BTC',  true, $1),
       ('SOL','BTC',  true, $1), ('BTC','SOL',  true, $1),
       ('ETH','SOL',  true, $1), ('SOL','ETH',  true, $1)
       ON CONFLICT DO NOTHING`,
      [now]
    );
    await client.query("COMMIT");
    console.log("DB bootstrap complete.");
  } catch (e) {
    await client.query("ROLLBACK");
    console.error("bootstrap error:", e);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

run();
