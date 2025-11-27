import "dotenv/config";
import { db } from "@/core/db/db";

const sessionId = Number(
  process.env.CIN_SMOKE_SESSION_ID ??
    process.env.CIN_RUNTIME_SESSION_ID ??
    "",
);

async function run() {
  console.log("[cin-db-smoke] market.account_trades (latest 5)");
  const trades = await db.query(
    `select symbol, trade_time, account_email, trade_id
       from market.account_trades
   order by trade_time desc
      limit 5`,
  );
  console.table(trades.rows);

  if (Number.isFinite(sessionId) && sessionId > 0) {
    console.log(`[cin-db-smoke] cin_aux.rt_move (session ${sessionId}, latest 5)`);
    const moves = await db.query(
      `select move_id, ts, from_asset, to_asset, src_symbol, src_trade_id
         from cin_aux.rt_move
        where session_id = $1
     order by ts desc
        limit 5`,
      [sessionId],
    );
    console.table(moves.rows);

    console.log(`[cin-db-smoke] cin_aux.rt_balance summary (session ${sessionId})`);
    const balances = await db.query(
      `select asset_id, principal_usdt, profit_usdt
         from cin_aux.rt_balance
        where session_id = $1
        order by asset_id asc
        limit 5`,
      [sessionId],
    );
    console.table(balances.rows);
  } else {
    console.log("[cin-db-smoke] session id not provided; skipping rt_move/rt_balance checks.");
  }
}

void run();
