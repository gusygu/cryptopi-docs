import { getPool } from "@/core/db/db";
import { seedUniverse } from "./seed-universe";
import { seedHydrate } from "./seed-hydrate";

(async () => {
  const pool = getPool();
  try {
    await seedUniverse();
    await seedHydrate();
  } catch (e) {
    console.error("Seeding failed:", e);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
})();
