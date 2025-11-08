// Minimal DB upsert smoke: writes a 2x2 grid (off-diagonal only) and reads it back.
// Usage:
//   node --env-file=.env .\src\scripts\smokes\db-upsert.cjs

require('ts-node/register/transpile-only');
require('tsconfig-paths/register');

const { upsertMatrixGrid, getPrevMatrixValue } = require('@/core/pipelines/pipeline.db');

(async () => {
  const bases = ['BTC','ETH'];
  const quote = 'USDT';
  const ts = Date.now();

  // diagonal ignored by design; off-diagonals will write
  const grid = [
    [ null, 2.0 ],
    [ 0.5,  null]
  ];

  const written = await upsertMatrixGrid('benchmark', bases, quote, grid, ts);
  console.info('[smoke:db-upsert] written', written);

  const back = await getPrevMatrixValue('benchmark', 'BTC', 'ETH', ts + 1);
  console.info('[smoke:db-upsert] read-back BTC->ETH', back);
})().catch(e => { console.error('[smoke:db-upsert] error', e); process.exit(1); });
