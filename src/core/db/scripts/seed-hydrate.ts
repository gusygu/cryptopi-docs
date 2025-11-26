/**
 * Hydrates matrices from current id_pct_latest for all coins.
 * Creates a new cin_session, registers matrices, and fills mat_cell.
 */
import { db } from "@/core/db/db";

type Sym = { symbol: string };
type SessionRow = { session_id: string };
type MatRow = { mat_id: number };
type IdPctRow = { id_pct: number };

export async function seedHydrate() {
  const { rows: coins } = await db.query<Sym>(
    "SELECT symbol FROM settings_coin_universe ORDER BY symbol"
  );
  if (!coins.length) {
    console.warn("⚠️  No universe found; run seed-universe first.");
    return;
  }

  const { rows: sessRows } = await db.query<SessionRow>(`
    INSERT INTO cin_session(window_label, window_bins, window_ms)
    VALUES ('H1@128', 128, 3600000)
    RETURNING session_id;
  `);
  const sessionId = sessRows[0].session_id;

  await db.query(
    `INSERT INTO session_coin_universe(session_id, symbol)
     SELECT $1, symbol FROM settings_coin_universe
     ON CONFLICT DO NOTHING`,
    [sessionId]
  );

  // one matrix per row-symbol
  const matIdBySymbol = new Map<string, number>();
  for (const { symbol } of coins) {
    const { rows } = await db.query<MatRow>(
      `INSERT INTO mat_registry(session_id, name, symbol, window_label, bins, meta)
       VALUES ($1,'id_pct',$2,'H1@128',128,'{}'::jsonb)
       RETURNING mat_id`,
      [sessionId, symbol]
    );
    matIdBySymbol.set(symbol, rows[0].mat_id);
  }

  // fill cells using id_pct_latest (fallback 0 when missing)
  for (let i = 0; i < coins.length; i++) {
    const base = coins[i].symbol;
    for (let j = 0; j < coins.length; j++) {
      const quote = coins[j].symbol;

      const { rows } = await db.query<IdPctRow>(
        `SELECT id_pct FROM id_pct_latest WHERE base=$1 AND quote=$2 LIMIT 1`,
        [base, quote]
      );
      const v = rows[0]?.id_pct ?? 0;

      await db.query(
        `INSERT INTO mat_cell(mat_id, i, j, v)
         VALUES ($1,$2,$3,$4)
         ON CONFLICT DO NOTHING`,
        [matIdBySymbol.get(base)!, i + 1, j + 1, v]
      );
    }
  }

  console.log(`✅ Matrices hydrated for session ${sessionId}`);
}
