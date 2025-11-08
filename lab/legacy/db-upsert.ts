/**
 * Minimal DB upsert smoke: writes a 2x2 grid (off-diagonal only) and prints rows written,
 * then reads back the latest-before value.
 *
 * PS:
 *   node --env-file=.env -r ts-node/register -r tsconfig-paths/register .\src\scripts\shards\db-upsert.ts
 */
import { upsertMatrixGrid, getPrevMatrixValue } from "@/core/pipelines/pipeline.db";

(async () => {
  const bases = ["BTC","ETH"];
  const quote = "USDT";
  const ts = Date.now();
  // 2x2 grid: diagonal ignored, set ETH/BTC = 0.5, BTC/ETH = 2.0
  const grid: (number|null)[][] = [
    [ null, 2.0 ],
    [ 0.5,  null],
  ];
  const written = await upsertMatrixGrid("benchmark", bases, quote, grid, ts);
  console.info("[shard:db-upsert] written", written);
  const back = await getPrevMatrixValue("benchmark", "BTC", "ETH", ts + 1);
  console.info("[shard:db-upsert] read-back BTC->ETH", back);
})().catch(e => { console.error("[shard:db-upsert] error", e); process.exit(1); });
