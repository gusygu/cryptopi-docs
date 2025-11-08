// src/core/runtime/reactiveCoins.ts
import type { Pool } from "pg";

export type CoinsSource = "settings_api" | "db" | "env" | "none";

export async function reactiveCoinsStrict(
  pool: Pool,
  baseUrl = process.env.BASE_URL ?? "http://localhost:3000"
): Promise<{ coins: string[]; from: CoinsSource }> {
  const REQUIRE_SETTINGS =
    (process.env.REQUIRE_SETTINGS_COINS ?? "false").toLowerCase() === "true";
  const ALLOW_ENV_FALLBACK =
    (process.env.ALLOW_ENV_FALLBACK ?? "true").toLowerCase() === "true";

  // 1) Settings API (reactive)
  try {
    const res = await fetch(`${baseUrl}/api/settings`, {
      headers: { accept: "application/json" },
      cache: "no-store",
    });
    if (res.ok) {
      const j = await res.json();
      const arr = Array.isArray(j?.coins)
        ? j.coins
        : typeof j?.coinsCsv === "string"
          ? j.coinsCsv.split(",")
          : null;
      const norm = (arr ?? [])
        .map((s: string) => s.trim().toUpperCase())
        .filter(Boolean);
      if (norm.length) return { coins: norm, from: "settings_api" };
    }
  } catch {
    /* ignore */
  }

  // 2) DB (reactive snapshot)
  try {
    const r = await pool.query(
      `
      SELECT COALESCE(coins_csv, coins, '') AS csv
      FROM (
        SELECT coins_csv, NULL::text AS coins, updated_at FROM app_settings
        UNION ALL
        SELECT NULL::text AS coins_csv, coins::text AS coins, updated_at FROM settings
      ) s
      WHERE COALESCE(coins_csv, coins) IS NOT NULL
      ORDER BY updated_at DESC NULLS LAST
      LIMIT 1
    `
    );
    const csv: string | undefined = r.rows?.[0]?.csv;
    if (csv) {
      const norm = csv
        .split(",")
        .map((s) => s.trim().toUpperCase())
        .filter(Boolean);
      if (norm.length) return { coins: norm, from: "db" };
    }
  } catch {
    /* ignore */
  }

  // 3) Strict mode? refuse to run without settings/db
  if (REQUIRE_SETTINGS) return { coins: [], from: "none" };

  // 4) Env fallback (non-reactive safety-net)
  const envCsv = process.env.COINS ?? "";
  const envSet = envCsv
    .split(",")
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean);
  if (envSet.length && ALLOW_ENV_FALLBACK)
    return { coins: envSet, from: "env" };

  return { coins: [], from: "none" };
}
