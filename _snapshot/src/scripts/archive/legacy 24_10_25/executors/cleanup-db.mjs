import { withClient, getPool } from "@/core/db";

export async function cleanupDatabase() {
  console.log("[cleanup-db] truncating strategy_aux schema…");
  await withClient(async (client) => {
    await client.query(`
      DO $$
      DECLARE r record;
      BEGIN
        FOR r IN SELECT tablename FROM pg_tables WHERE schemaname = 'strategy_aux' LOOP
          EXECUTE format('TRUNCATE TABLE strategy_aux.%I RESTART IDENTITY CASCADE', r.tablename);
        END LOOP;
      END $$;
    `);
  });
  await getPool().end();
  console.log("[cleanup-db] done");
}

if (process.argv[1]?.endsWith("cleanup-db.mjs")) {
  cleanupDatabase()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error("[cleanup-db] failed", err);
      process.exit(1);
    });
}
