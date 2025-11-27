import { db } from "@/core/db/db";
import type {
  CinRuntimeAssetPnl,
  CinRuntimeSessionSummary,
  CinRuntimeStatus,
} from "./cinAuxContracts";

const STATUS_DRIFTED = 0.005;
const STATUS_BROKEN = 0.02;

function asString(value: unknown, fallback = "0"): string {
  if (value === null || value === undefined) return fallback;
  return typeof value === "string" ? value : String(value);
}

function toNumber(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function runtimeStatusFromDelta(deltaRatio: unknown): CinRuntimeStatus {
  const ratio = Number(deltaRatio);
  if (!Number.isFinite(ratio)) return "balanced";
  const abs = Math.abs(ratio);
  if (abs >= STATUS_BROKEN) return "broken";
  if (abs >= STATUS_DRIFTED) return "drifted";
  return "balanced";
}

export function mapRuntimeSessionRow(row: any): CinRuntimeSessionSummary {
  return {
    sessionId: Number(row.session_id),
    windowLabel: row.window_label,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    closed: Boolean(row.closed),
    imprintPrincipalChurnUsdt: asString(row.imprint_principal_churn_usdt),
    imprintProfitChurnUsdt: asString(row.imprint_profit_churn_usdt),
    imprintGeneratedProfitUsdt: asString(row.imprint_generated_profit_usdt ?? "0"),
    imprintTraceSumUsdt: asString(row.imprint_trace_sum_usdt ?? "0"),
    imprintDevrefSumUsdt: asString(row.imprint_devref_sum_usdt ?? "0"),
    luggageTotalPrincipalUsdt: asString(row.luggage_total_principal_usdt),
    luggageTotalProfitUsdt: asString(row.luggage_total_profit_usdt),
    cinTotalMtmUsdt: row.cin_total_mtm_usdt != null ? asString(row.cin_total_mtm_usdt) : null,
    refTotalUsdt: row.ref_total_usdt != null ? asString(row.ref_total_usdt) : null,
    deltaUsdt: row.delta_usdt != null ? asString(row.delta_usdt) : null,
    deltaRatio: row.delta_ratio != null ? asString(row.delta_ratio) : null,
    status: runtimeStatusFromDelta(row.delta_ratio),
  };
}

export async function fetchRuntimeSessionSummary(
  sessionId: number,
): Promise<CinRuntimeSessionSummary | null> {
  const { rows } = await db.query(
    `
      SELECT s.*, recon.cin_total_mtm_usdt, recon.ref_total_usdt, recon.delta_usdt, recon.delta_ratio
        FROM cin_aux.v_rt_session_summary s
        LEFT JOIN cin_aux.v_rt_session_recon recon
          ON recon.session_id = s.session_id
       WHERE s.session_id = $1
    `,
    [sessionId],
  );
  if (rows.length === 0) return null;
  return mapRuntimeSessionRow(rows[0]);
}

export async function listRuntimeSessions(ownerUserId: string): Promise<CinRuntimeSessionSummary[]> {
  const { rows } = await db.query(
    `
      SELECT s.*, recon.cin_total_mtm_usdt, recon.ref_total_usdt, recon.delta_usdt, recon.delta_ratio
        FROM cin_aux.v_rt_session_summary s
        LEFT JOIN cin_aux.v_rt_session_recon recon
          ON recon.session_id = s.session_id
       WHERE s.owner_user_id = $1
       ORDER BY s.started_at DESC
    `,
    [ownerUserId],
  );
  return rows.map(mapRuntimeSessionRow);
}

export async function fetchRuntimeAssets(
  sessionId: number,
): Promise<(CinRuntimeAssetPnl & { inUniverse: boolean; referenceUsdt: string | null })[]> {
  const { rows } = await db.query(
    `
      SELECT
        ap.*,
        (cu.base_asset IS NOT NULL) AS in_universe,
        ref.ref_usdt
      FROM cin_aux.v_rt_asset_pnl ap
      LEFT JOIN settings.coin_universe cu
        ON cu.enabled = TRUE
       AND cu.base_asset IS NOT NULL
       AND UPPER(cu.base_asset) = UPPER(ap.asset_id)
      LEFT JOIN cin_aux.rt_reference ref
        ON ref.session_id = ap.session_id
       AND UPPER(ref.asset_id) = UPPER(ap.asset_id)
      WHERE ap.session_id = $1
      ORDER BY ap.mtm_value_usdt DESC NULLS LAST, ap.asset_id ASC
    `,
    [sessionId],
  );

  const totalMtm = rows.reduce((acc, row) => acc + toNumber(row.mtm_value_usdt), 0);

  return rows.map((row) => {
    const mtmValue = toNumber(row.mtm_value_usdt);
    return {
      sessionId: Number(row.session_id),
      assetId: row.asset_id,
      openingPrincipal: asString(row.opening_principal ?? "0"),
      openingProfit: asString(row.opening_profit ?? "0"),
      principalUsdt: asString(row.principal_usdt ?? "0"),
      profitUsdt: asString(row.profit_usdt ?? "0"),
      lastMarkTs: row.last_mark_ts,
      priceUsdt: row.price_usdt != null ? asString(row.price_usdt) : null,
      bulkUsdt: asString(row.bulk_usdt ?? "0"),
      mtmValueUsdt: asString(row.mtm_value_usdt ?? "0"),
      weightInPortfolio:
        totalMtm > 0 && Number.isFinite(mtmValue) ? mtmValue / totalMtm : null,
      realizedPnlUsdt: row.realized_pnl_usdt != null ? asString(row.realized_pnl_usdt) : null,
      inUniverse: Boolean(row.in_universe),
      referenceUsdt: row.ref_usdt != null ? asString(row.ref_usdt) : null,
    };
  });
}

export const KNOWN_STABLE_QUOTES = ["USDT", "FDUSD", "USDC", "TUSD", "BUSD", "USD", "BTC", "ETH", "BNB"];

export async function fetchUniverseBaseAssets(): Promise<Set<string>> {
  const { rows } = await db.query(
    `
      SELECT DISTINCT UPPER(asset) AS asset
        FROM (
          SELECT base_asset AS asset
            FROM settings.coin_universe
           WHERE enabled = TRUE AND base_asset IS NOT NULL
          UNION ALL
          SELECT quote_asset AS asset
            FROM settings.coin_universe
           WHERE enabled = TRUE AND quote_asset IS NOT NULL
        ) scoped
       WHERE asset IS NOT NULL
    `,
  );
  const universe = new Set<string>();
  for (const row of rows) {
    if (row.asset) {
      universe.add(row.asset);
    }
  }
  for (const stable of KNOWN_STABLE_QUOTES) {
    universe.add(stable);
  }
  return universe;
}
