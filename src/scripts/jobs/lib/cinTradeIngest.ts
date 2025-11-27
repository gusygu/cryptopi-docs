import { db } from "@/core/db/db";
import type {
  AccountTrade,
  ConvertTradeFlowItem,
} from "@/core/sources/binanceAccount";
import { fetchTickersForCoins } from "@/core/sources/binance";

const ensuredConvertSymbols = new Set<string>();
const PRICE_TTL_MS = 60_000;
const priceCache = new Map<string, { at: number; price: number | null }>();

function normalizeAsset(value?: string | null): string {
  return String(value ?? "").trim().toUpperCase();
}

export function normalizeAccountScope(scope?: string | null): string {
  return scope ? scope.toLowerCase() : "__env__";
}

export async function insertAccountTrade(
  symbol: string,
  trade: AccountTrade,
  scope: string,
  rawPayload?: unknown,
): Promise<boolean> {
  const normalizedSymbol = normalizeAsset(symbol);
  if (!normalizedSymbol) return false;

  const payload = rawPayload ?? trade;
  const { rowCount } = await db.query(
    `insert into market.account_trades (
       symbol,
       trade_id,
       order_id,
       price,
       qty,
       quote_qty,
       commission,
       commission_asset,
       trade_time,
       is_buyer,
       is_maker,
       is_best_match,
       account_email,
       raw
     )
     values (
       $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14
     )
     on conflict (symbol, trade_id) do nothing`,
    [
      normalizedSymbol,
      trade.id,
      trade.orderId,
      trade.price,
      trade.qty,
      trade.quoteQty,
      trade.commission ?? "0",
      trade.commissionAsset ?? null,
      new Date(trade.time),
      trade.isBuyer,
      trade.isMaker,
      trade.isBestMatch,
      normalizeAccountScope(scope),
      JSON.stringify(payload),
    ],
  );
  return rowCount > 0;
}

async function ensureConvertSymbol(symbol: string, base: string, quote: string) {
  if (ensuredConvertSymbols.has(symbol)) return;
  await db.query(`select market.sp_upsert_symbol($1,$2,$3,$4)`, [
    symbol,
    base,
    quote,
    "CONVERT",
  ]);
  ensuredConvertSymbols.add(symbol);
}

export async function insertConvertTrade(
  entry: ConvertTradeFlowItem,
  scope: string,
): Promise<boolean> {
  const base = normalizeAsset(entry.toAsset);
  const quote = normalizeAsset(entry.fromAsset);
  if (!base || !quote) return false;
  const symbol = `${base}${quote}`;
  await ensureConvertSymbol(symbol, base, quote);

  let fromPriceUsdt = await readAssetUsdtPrice(quote);
  let toPriceUsdt = await readAssetUsdtPrice(base);
  if (fromPriceUsdt == null && quote !== "USDT") {
    await primeAssetPriceCache([quote]);
    fromPriceUsdt = await readAssetUsdtPrice(quote);
  }
  if (toPriceUsdt == null && base !== "USDT") {
    await primeAssetPriceCache([base]);
    toPriceUsdt = await readAssetUsdtPrice(base);
  }

  const qty = entry.toAmount ?? "0";
  const quoteQty = entry.fromAmount ?? "0";
  const price =
    entry.price && Number(entry.price)
      ? entry.price
      : Number(quoteQty) !== 0
        ? (Number(qty) / Number(quoteQty)).toString()
        : "0";

  const trade: AccountTrade = {
    id: Number(entry.orderId),
    orderId: Number(entry.orderId),
    price,
    qty,
    quoteQty,
    commission: entry.fee ?? "0",
    commissionAsset: entry.feeAsset ?? "",
    time: Number(entry.createTime),
    isBuyer: true,
    isMaker: false,
    isBestMatch: true,
  };

  return insertAccountTrade(symbol, trade, scope, {
    source: "convert",
    notionalUsdt: computeNotionalUsdt(quoteQty, qty, fromPriceUsdt, toPriceUsdt),
    fromPriceUsdt,
    toPriceUsdt,
    ...entry,
  });
}

export async function getLastConvertTradeMs(scope: string): Promise<number | null> {
  const { rows } = await db.query<{ last_ms: string | null }>(
    `select max(extract(epoch from trade_time) * 1000)::bigint as last_ms
       from market.account_trades
      where raw ->> 'source' = 'convert'
        and (
          $1 = '__env__'
          or account_email is null
          or lower(account_email) = lower($1)
        )`,
    [normalizeAccountScope(scope)],
  );
  const rawValue = rows[0]?.last_ms;
  if (rawValue == null) return null;
  const parsed = Number(rawValue);
  return Number.isFinite(parsed) ? parsed : null;
}

export async function primeAssetPriceCache(assets: string[]): Promise<void> {
  const unique = Array.from(
    new Set(
      assets
        .map((asset) => normalizeAsset(asset))
        .filter((asset) => asset && asset !== "USDT"),
    ),
  );
  if (!unique.length) return;
  const now = Date.now();
  const missing = unique.filter((asset) => {
    const cached = priceCache.get(asset);
    return !cached || now - cached.at > PRICE_TTL_MS;
  });
  if (!missing.length) return;
  try {
    const quotes = await fetchTickersForCoins(missing);
    const updatedAt = Date.now();
    for (const asset of missing) {
      const price = quotes[asset]?.price;
      priceCache.set(asset, {
        at: updatedAt,
        price: Number.isFinite(price) ? Number(price) : null,
      });
    }
  } catch (err) {
    console.warn("[cin-convert] failed to prime price cache:", err);
  }
}

async function readAssetUsdtPrice(asset: string): Promise<number | null> {
  const coin = normalizeAsset(asset);
  if (!coin) return null;
  if (coin === "USDT") return 1;
  const cached = priceCache.get(coin);
  if (cached && Date.now() - cached.at < PRICE_TTL_MS) {
    return cached.price;
  }
  await primeAssetPriceCache([coin]);
  const refreshed = priceCache.get(coin);
  return refreshed ? refreshed.price : null;
}

function computeNotionalUsdt(
  quoteQty: string,
  qty: string,
  fromPriceUsdt: number | null,
  toPriceUsdt: number | null,
): number | null {
  const quote = Number(quoteQty);
  if (Number.isFinite(quote) && fromPriceUsdt != null) {
    return quote * fromPriceUsdt;
  }
  const base = Number(qty);
  if (Number.isFinite(base) && toPriceUsdt != null) {
    return base * toPriceUsdt;
  }
  return null;
}
