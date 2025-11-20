import { NextResponse } from "next/server";
import { query } from "@/core/db/pool_server";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type UniverseRow = {
  symbol: string;
  base_asset: string | null;
  quote_asset: string | null;
  enabled: boolean | null;
};

export async function GET() {
  try {
    const { rows } = await query<UniverseRow>(
      `SELECT symbol,
              base_asset,
              quote_asset,
              COALESCE(enabled, true) AS enabled
         FROM settings.coin_universe
        ORDER BY sort_order NULLS LAST, symbol`
    );

    const entries = rows.map((row) => ({
      symbol: String(row.symbol ?? "").trim().toUpperCase(),
      base: String(row.base_asset ?? "").trim().toUpperCase(),
      quote: String(row.quote_asset ?? "").trim().toUpperCase(),
      enabled: row.enabled !== false,
    }));

    const enabledSymbols = entries
      .filter((entry) => entry.enabled && entry.symbol)
      .map((entry) => entry.symbol);

    return NextResponse.json({
      ok: true,
      symbols: enabledSymbols,
      entries,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
