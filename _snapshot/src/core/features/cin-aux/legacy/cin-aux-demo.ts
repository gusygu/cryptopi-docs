#!/usr/bin/env tsx
import "dotenv/config";
import { createCinSession, seedBalance, execMoveV2, addMark, closeCinSessionV2 } from "./repo";
// If you prefer to consume on move 1, seed a lot instead (see commented helper below).

async function main() {
  // 1) session
  const sessionId = await createCinSession("demo-1h");
  console.log("sessionId:", sessionId);

  // 2) seed balances (opening == current)
  await seedBalance(sessionId, "BTCUSDT", 1000, 0);
  await seedBalance(sessionId, "ETHUSDT", 0, 0);
  await seedBalance(sessionId, "BNBUSDT", 0, 0);

  // // OPTIONAL: If you want to consume on move 1, uncomment this block:
  // await seedLot(sessionId, "BTCUSDT", 1000 / 68000, 68000);

  // 3) BTC → ETH, executed 700 USDT, do NOT consume BTC lots on first move
  const m1 = await execMoveV2({
    sessionId,
    ts: new Date(),
    fromAsset: "BTCUSDT",
    toAsset: "ETHUSDT",
    executedUSDT: 700,
    feeUSDT: 2,
    slippageUSDT: 0,
    refTargetUSDT: null,
    plannedUSDT: null,
    availableUSDT: 1000,
    priceFromUSDT: 68000,        // informational
    priceToUSDT: 3200,           // creates ETH lot
    priceBridgeUSDT: null        // <-- key: don't try to consume BTC lot on first move
  });
  console.log("move 1 id:", m1);

  // 4) ETH → BNB, now DO consume ETH lots created in move 1
  const m2 = await execMoveV2({
    sessionId,
    ts: new Date(),
    fromAsset: "ETHUSDT",
    toAsset: "BNBUSDT",
    executedUSDT: 600,
    feeUSDT: 1,
    slippageUSDT: 0,
    refTargetUSDT: null,
    plannedUSDT: null,
    availableUSDT: 800,
    priceFromUSDT: 3400,
    priceToUSDT: 240,            // creates BNB lot
    priceBridgeUSDT: 3400        // consumes ETH FIFO lots
  });
  console.log("move 2 id:", m2);

  // 5) marks and close
  await addMark(sessionId, "BTCUSDT", 298);
  await addMark(sessionId, "ETHUSDT", 160);
  await addMark(sessionId, "BNBUSDT", 590);

  await closeCinSessionV2(sessionId);
  console.log("session closed.");
}

main().catch((e) => {
  console.error("demo failed:", e);
  process.exit(1);
});

/* OPTIONAL helper if you want to seed a starting lot and consume on move 1:
import { sql } from "../core/db/client";
async function seedLot(sessionId: number, assetId: string, units: number, pInUSDT: number) {
  await sql(
    `insert into strategy_aux.cin_lot(session_id, asset_id, units_free, p_in_usdt, created_at)
     values ($1,$2,$3,$4, now())`,
    sessionId, assetId, units, pInUSDT
  );
}
*/
