// src/core/settings/matrices.ts
import { query } from "../db/pool_server";

export async function loadMatricesSettings() {
  // prefer env override; otherwise, DB coin_universe
  const envBases = process.env.MATRICES_BASES?.split(",").map(s => s.trim().toUpperCase()).filter(Boolean);
  const envQuote = (process.env.MATRICES_QUOTE ?? "USDT").toUpperCase();
  if (envBases?.length) return { bases: envBases, quote: envQuote, periodMs: 60_000 };

  // DB-driven:
  const { rows } = await query<{ base_asset: string; quote_asset: string }>(`
    SELECT base_asset, quote_asset
    FROM settings.coin_universe
    WHERE enabled = true
    ORDER BY COALESCE(sort_order, 999), base_asset
  `);

  const bases = rows.map(r => r.base_asset.toUpperCase());
  const quote = rows[0]?.quote_asset?.toUpperCase() || envQuote;
  return { bases, quote, periodMs: 60_000 };
}
