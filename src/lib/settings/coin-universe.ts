import { query } from "@/core/db/pool_server";
import { normalizeCoin } from "@/lib/markets/pairs";

const SORT_SENTINEL = 2_147_483_647;

export type CoinUniverseEntry = {
  symbol: string;
  base: string;
  quote: string;
  enabled: boolean;
  sortOrder: number | null;
};

export type PairUniverseEntry = {
  base: string;
  quote: string;
};

type FetchOptions = {
  onlyEnabled?: boolean;
};

export function normalizeCoinList(input: unknown): string[] {
  const arr = Array.isArray(input) ? input : [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of arr) {
    const coin = normalizeCoin(raw as string);
    if (!coin || seen.has(coin)) continue;
    seen.add(coin);
    out.push(coin);
  }
  if (!seen.has("USDT")) {
    seen.add("USDT");
    out.push("USDT");
  }
  return out;
}

export async function fetchCoinUniverseEntries(options: FetchOptions = {}): Promise<CoinUniverseEntry[]> {
  try {
    const { rows } = await query<{
      symbol: string;
      base: string | null;
      quote: string | null;
      enabled: boolean | null;
      sort_order: number | null;
    }>(
      `
        select
          symbol,
          upper(coalesce(base_asset, (public._split_symbol(symbol)).base)) as base,
          upper(coalesce(quote_asset, (public._split_symbol(symbol)).quote)) as quote,
          coalesce(enabled, true) as enabled,
          sort_order
        from settings.coin_universe
        ${options.onlyEnabled ? "where coalesce(enabled, true) = true" : ""}
        order by coalesce(sort_order, $1::int), symbol
      `,
      [SORT_SENTINEL]
    );

    return rows
      .filter((row) => row.base && row.quote)
      .map((row) => ({
        symbol: row.symbol?.toUpperCase() ?? "",
        base: row.base!.toUpperCase(),
        quote: row.quote!.toUpperCase(),
        enabled: Boolean(row.enabled ?? true),
        sortOrder: row.sort_order,
      }))
      .filter((entry) => entry.symbol.length > 0);
  } catch (err) {
    console.warn("[settings] coin universe query failed:", err);
    return [];
  }
}

export async function fetchPairUniversePairs(): Promise<PairUniverseEntry[]> {
  try {
    const { rows } = await query<{ base: string | null; quote: string | null }>(
      `
        select base, quote
        from matrices.v_pair_universe
      `
    );
    return rows
      .map((row) => ({
        base: row.base?.toUpperCase().trim() ?? "",
        quote: row.quote?.toUpperCase().trim() ?? "",
      }))
      .filter((row) => row.base && row.quote && row.base !== row.quote);
  } catch (err) {
    console.warn("[settings] pair universe query failed:", err);
    return [];
  }
}

export async function fetchPairUniverseCoins(): Promise<string[]> {
  const pairs = await fetchPairUniversePairs();
  if (!pairs.length) return [];

  const set = new Set<string>();
  for (const { base, quote } of pairs) {
    if (base) set.add(base);
    if (quote) set.add(quote);
  }
  if (!set.has("USDT")) set.add("USDT");
  return Array.from(set);
}

export async function fetchCoinUniverseBases(options: FetchOptions = {}): Promise<string[]> {
  const entries = await fetchCoinUniverseEntries(options);
  const bases = entries
    .filter((entry) => (options.onlyEnabled ? entry.enabled : true))
    .map((entry) => entry.base);
  return normalizeCoinList(bases);
}

export async function syncCoinUniverseFromBases(bases: string[]): Promise<void> {
  const normalized = normalizeCoinList(bases);
  if (!normalized.length) return;

  const symbols = normalized
    .filter((coin) => coin !== "USDT")
    .map((coin) => `${coin}USDT`);

  if (!symbols.length) return;

  try {
    await query(`select settings.sp_sync_coin_universe($1::text[])`, [symbols]);
  } catch (err) {
    console.warn("[settings] sync coin universe failed:", err);
  }
}

export async function recordSettingsCookieSnapshot(jsonValue: string | null | undefined): Promise<void> {
  if (!jsonValue) return;
  try {
    await query(
      `
        insert into settings.cookies(name, value, updated_at)
        values ('appSettings', $1::jsonb, now())
        on conflict (name) do update
          set value = excluded.value,
              updated_at = excluded.updated_at
      `,
      [jsonValue]
    );
  } catch (err) {
    // table might not exist yet; log once for awareness
    console.warn("[settings] cookie snapshot skipped:", err);
  }
}
