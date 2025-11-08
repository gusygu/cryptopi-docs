import type { PoolClient } from "pg";

import { db, withClient } from "@/core/db/db";
import { getBinancePreviewCoins } from "@/core/api/market/binance";
import {
  buildValidPairsFromCoins,
  type TradableSymbol,
} from "@/core/sources/pairs";

type Queryable = Pick<PoolClient, "query">;

export type CoinUniverseRow = {
  symbol: string;
  enabled: boolean;
  sort_order: number | null;
  base_asset: string | null;
  quote_asset: string | null;
  metadata: Record<string, unknown> | null;
};

export type CoinUniverseSnapshot = {
  coins: string[];
  symbols: string[];
  rows: CoinUniverseRow[];
};

export type SyncCoinUniverseOptions = {
  client?: PoolClient;
  explicitCoins?: string[];
  quote?: string;
  spotOnly?: boolean;
  disableMissing?: boolean;
};

export type SyncCoinUniverseResult = CoinUniverseSnapshot & {
  inserted: number;
  updated: number;
  disabled: number;
  pairs: TradableSymbol[];
};

const SELECT_UNIVERSE_SQL = `
  SELECT symbol, enabled, sort_order, base_asset, quote_asset, metadata
    FROM settings.coin_universe
ORDER BY sort_order NULLS LAST, symbol
`;

const ARRAY_PARAM_TYPE = "text[]";

function asQueryable(client?: PoolClient): Queryable {
  return client ?? db;
}

function upper(value: string | null | undefined): string {
  return String(value ?? "").trim().toUpperCase();
}

function deriveCoins(rows: readonly CoinUniverseRow[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();

  const push = (input: string | null | undefined) => {
    const coin = upper(input);
    if (!coin || seen.has(coin)) return;
    seen.add(coin);
    out.push(coin);
  };

  for (const row of rows) {
    if (!row.enabled) continue;
    const symbol = upper(row.symbol);
    const base =
      row.base_asset && row.base_asset.trim().length
        ? row.base_asset
        : symbol.endsWith("USDT")
        ? symbol.slice(0, -4)
        : symbol;
    push(base);
    push(row.quote_asset);
  }

  if (seen.has("USDT")) {
    const idx = out.indexOf("USDT");
    if (idx > 0) {
      out.splice(idx, 1);
      out.unshift("USDT");
    }
  } else if (out.length) {
    out.unshift("USDT");
    seen.add("USDT");
  }

  return out;
}

function toSnapshot(rows: CoinUniverseRow[]): CoinUniverseSnapshot {
  const coins = deriveCoins(rows);
  const symbols = rows
    .filter((row) => row.enabled)
    .map((row) => upper(row.symbol));
  return { coins, symbols, rows };
}

export async function fetchCoinUniverseRows(
  client?: PoolClient
): Promise<CoinUniverseRow[]> {
  const runner = asQueryable(client);
  const { rows } = await runner.query<CoinUniverseRow>(SELECT_UNIVERSE_SQL);
  return rows.map((row) => ({
    ...row,
    symbol: upper(row.symbol),
    base_asset: row.base_asset ? upper(row.base_asset) : null,
    quote_asset: row.quote_asset ? upper(row.quote_asset) : null,
    metadata: row.metadata ?? {},
  }));
}

export async function resolveCoinUniverseSnapshot(
  client?: PoolClient
): Promise<CoinUniverseSnapshot> {
  const rows = await fetchCoinUniverseRows(client);
  return toSnapshot(rows);
}

export async function resolveEnabledCoins(client?: PoolClient): Promise<string[]> {
  const snapshot = await resolveCoinUniverseSnapshot(client);
  return snapshot.coins;
}

type InternalSyncOptions = {
  explicitCoins?: string[];
  quote?: string;
  spotOnly: boolean;
  disableMissing: boolean;
  manageTransaction: boolean;
};

async function executeSync(
  connection: PoolClient,
  opts: InternalSyncOptions
): Promise<SyncCoinUniverseResult> {
  const { explicitCoins, quote, spotOnly, disableMissing, manageTransaction } = opts;

  const normalizedQuote = upper(quote);
  const nowIso = new Date().toISOString();

  if (manageTransaction) {
    await connection.query("BEGIN");
  }

  try {
    let finalResult: SyncCoinUniverseResult | null = null;

    const coins =
      explicitCoins && explicitCoins.length
        ? explicitCoins.map(upper)
        : (
            await getBinancePreviewCoins({
              quote: normalizedQuote || undefined,
              spotOnly,
            })
          ).coins;

    const uniqCoins = Array.from(
      new Set(coins.map((c) => upper(c)).filter(Boolean))
    );

    if (!uniqCoins.length) {
      const snapshot = await resolveCoinUniverseSnapshot(connection);
      finalResult = {
        ...snapshot,
        inserted: 0,
        updated: 0,
        disabled: 0,
        pairs: [],
      };
    } else {
      const pairs = await buildValidPairsFromCoins(uniqCoins);
      const intendedSet = new Set(pairs.map((pair) => upper(pair.symbol)));

      const existingRows = await fetchCoinUniverseRows(connection);
      const existingMap = new Map<string, CoinUniverseRow>();
      for (const row of existingRows) existingMap.set(upper(row.symbol), row);

      let inserted = 0;
      let updated = 0;

      for (const pair of pairs) {
        const symbol = upper(pair.symbol);
        const base = upper(pair.base);
        const quoteAsset = upper(pair.quote);
        const prior = existingMap.get(symbol);

        const metadata = JSON.stringify({
          source: "binance",
          syncedAt: nowIso,
        });

        await connection.query(
          `
          INSERT INTO settings.coin_universe(symbol, base_asset, quote_asset, enabled, metadata)
          VALUES ($1, $2, $3, true, $4::jsonb)
          ON CONFLICT (symbol) DO UPDATE
            SET base_asset  = EXCLUDED.base_asset,
                quote_asset = EXCLUDED.quote_asset,
                enabled     = true,
                metadata    = coalesce(settings.coin_universe.metadata, '{}'::jsonb) || EXCLUDED.metadata
          `,
          [symbol, base || null, quoteAsset || null, metadata]
        );

        if (prior) {
          updated += 1;
        } else {
          inserted += 1;
        }
      }

      let disabled = 0;
      const shouldDisableMissing = disableMissing !== false;

      if (shouldDisableMissing) {
        if (intendedSet.size) {
          const { rowCount } = await connection.query(
            `
            UPDATE settings.coin_universe
               SET enabled = false
             WHERE enabled = true
               AND NOT (symbol = ANY($1::${ARRAY_PARAM_TYPE}))
            `,
            [Array.from(intendedSet)]
          );
          disabled = rowCount ?? 0;
        } else {
          const { rowCount } = await connection.query(
            `UPDATE settings.coin_universe SET enabled = false WHERE enabled = true`
          );
          disabled = rowCount ?? 0;
        }
      }

      await connection.query(
        `
        INSERT INTO market.symbols(symbol, base_asset, quote_asset, base, quote)
        SELECT cu.symbol, cu.base_asset, cu.quote_asset, cu.base_asset, cu.quote_asset
          FROM settings.coin_universe cu
         WHERE cu.enabled = true
        ON CONFLICT (symbol) DO UPDATE
          SET base_asset  = EXCLUDED.base_asset,
              quote_asset = EXCLUDED.quote_asset,
              base        = EXCLUDED.base,
              quote       = EXCLUDED.quote
        `
      );

      await connection.query(`SELECT market.sync_wallet_assets_from_universe_helper()`);

      const snapshot = await resolveCoinUniverseSnapshot(connection);

      finalResult = {
        ...snapshot,
        inserted,
        updated,
        disabled,
        pairs,
      };
    }

    if (!finalResult) {
      // Should not happen, but satisfy type checker.
      const snapshot = await resolveCoinUniverseSnapshot(connection);
      finalResult = {
        ...snapshot,
        inserted: 0,
        updated: 0,
        disabled: 0,
        pairs: [],
      };
    }

    if (manageTransaction) {
      await connection.query("COMMIT");
    }

    return finalResult;
  } catch (error) {
    if (manageTransaction) {
      await connection.query("ROLLBACK");
    }
    throw error;
  }
}

export async function syncCoinUniverseFromBinance(
  options: SyncCoinUniverseOptions = {}
): Promise<SyncCoinUniverseResult> {
  const { client, ...rest } = options;

  const baseOpts: Omit<InternalSyncOptions, "manageTransaction"> = {
    explicitCoins: rest.explicitCoins,
    quote: rest.quote,
    spotOnly: rest.spotOnly ?? true,
    disableMissing: rest.disableMissing ?? true,
  };

  if (client) {
    return executeSync(client, { ...baseOpts, manageTransaction: false });
  }

  return withClient((pgClient) =>
    executeSync(pgClient, { ...baseOpts, manageTransaction: true })
  );
}
