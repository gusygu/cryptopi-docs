import "dotenv/config";
import { db } from "@/core/db/db";

const sessionId = Number(
  process.env.CIN_SMOKE_SESSION_ID ??
    process.env.CIN_RUNTIME_SESSION_ID ??
    "",
);
if (!Number.isFinite(sessionId) || sessionId <= 0) {
  throw new Error("Set CIN_SMOKE_SESSION_ID (or CIN_RUNTIME_SESSION_ID) to a valid runtime session id.");
}

const scope =
  (process.env.CIN_SMOKE_EMAIL ??
    process.env.CIN_WATCH_ACCOUNT_SCOPE ??
    "__env__")?.toLowerCase() || "__env__";

async function run() {
  console.log(`[cin-pipeline-smoke] Importing moves for session ${sessionId} (${scope}).`);
  const importRes = await db.query<{ import_moves_from_account_trades: number }>(
    `select cin_aux.import_moves_from_account_trades($1,$2)`,
    [sessionId, scope],
  );
  const importedMoves = importRes.rows[0]?.import_moves_from_account_trades ?? 0;
  console.log(`[cin-pipeline-smoke] Moves imported: ${importedMoves}`);

  console.log("[cin-pipeline-smoke] Refreshing wallet balances.");
  const refreshRes = await db.query(
    `select asset_id, principal_usdt, profit_usdt
       from cin_aux.rt_balance
      where session_id = $1
      order by asset_id asc
      limit 5`,
    [sessionId],
  );
  console.table(refreshRes.rows);
}

void run();
