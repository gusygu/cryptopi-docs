import "dotenv/config";
import { db } from "@/core/db/db";

const sessionId = Number(
  process.env.CIN_SMOKE_SESSION_ID ??
    process.env.CIN_RUNTIME_SESSION_ID ??
    "",
);
if (!Number.isFinite(sessionId) || sessionId <= 0) {
  throw new Error("Set CIN_SMOKE_SESSION_ID (or CIN_RUNTIME_SESSION_ID) to run core calculations sanity checks.");
}

async function run() {
  console.log(`[cin-core-smoke] Checking luggage/imprint consistency for session ${sessionId}`);
  const sumRes = await db.query<{
    principal_sum: string | null;
    profit_sum: string | null;
  }>(
    `select sum(principal_usdt) as principal_sum,
            sum(profit_usdt)    as profit_sum
       from cin_aux.rt_balance
      where session_id = $1`,
    [sessionId],
  );
  const principalSum = Number(sumRes.rows[0]?.principal_sum ?? 0);
  const profitSum = Number(sumRes.rows[0]?.profit_sum ?? 0);

  const imprintRes = await db.query<{
    luggage_total_principal_usdt: string | null;
    luggage_total_profit_usdt: string | null;
  }>(
    `select luggage_total_principal_usdt,
            luggage_total_profit_usdt
       from cin_aux.rt_imprint_luggage
      where session_id = $1`,
    [sessionId],
  );
  const luggagePrincipal = Number(
    imprintRes.rows[0]?.luggage_total_principal_usdt ?? 0,
  );
  const luggageProfit = Number(imprintRes.rows[0]?.luggage_total_profit_usdt ?? 0);

  console.log("Balances sum:", { principalSum, profitSum });
  console.log("Imprint luggage totals:", { luggagePrincipal, luggageProfit });
  console.log("Delta:", {
    principalDelta: principalSum - luggagePrincipal,
    profitDelta: profitSum - luggageProfit,
  });
}

void run();
