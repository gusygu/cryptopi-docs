// src/scripts/jobs/cin-import-moves.ts
import { db } from "@/core/db/db";

async function run() {
  // find all "open" cin sessions (depends on your schema)
  const sessions = await db.query<{ session_id: number }>(
    `select session_id
       from cin_aux.rt_session
      where status = 'OPEN'`
  );

  for (const s of sessions.rows) {
    const sid = s.session_id;
    const res = await db.query<{ import_moves_from_account_trades: number }>(
      `select cin_aux.import_moves_from_account_trades($1)`,
      [sid]
    );
    const imported = res.rows[0]?.import_moves_from_account_trades ?? 0;
    console.log(`session ${sid}: imported ${imported} move(s)`);
  }
}

run().then(
  () => process.exit(0),
  (err) => {
    console.error(err);
    process.exit(1);
  }
);
