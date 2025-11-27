import fetchOnce from "./fetch_klines.mts";
import computeVectors from "./compute_vectors.mts";
import computeStats from "./compute_stats.mts";

const BASE_DELAY_MS = Number(process.env.JOB_DELAY_MS ?? 30_000);

async function tick() {
  await fetchOnce();
  await computeVectors();
  await computeStats();
}

async function main() {
   
  while (true) {
    const t0 = Date.now();
    try { await tick(); }
    catch (e:any) { console.error(new Date().toISOString(), "tick error:", e?.message ?? e); }
    const elapsed = Date.now() - t0;
    const wait = Math.max(1000, BASE_DELAY_MS - elapsed);
    await new Promise(r => setTimeout(r, wait));
  }
}
if ((import.meta as any).main) main();
