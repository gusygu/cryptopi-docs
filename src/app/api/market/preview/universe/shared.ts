import { getBinancePreviewCoins } from "@/core/api/market/binance";
import { resolveCoinsFromSettings } from "@/lib/settings/server";

const DEFAULT_QUOTE = "USDT";

const toUpper = (value: string | null | undefined) =>
  String(value ?? "").trim().toUpperCase();

const sanitizeAlphaNum = (value: string) =>
  value.replace(/[^A-Z0-9]/g, "");

export const normalizeQuote = (input: string | null | undefined): string => {
  const normalized = sanitizeAlphaNum(toUpper(input));
  return normalized || DEFAULT_QUOTE;
};

export type PreviewUniverseSnapshot = {
  quote: string;
  previewCoins: string[];
  previewSymbols: string[];
  settingsCoins: string[];
  coins: string[];
  symbols: string[];
  cached: boolean;
  updatedAt: string;
  note?: string;
};

export type PreviewUniverseOptions = {
  quote?: string | null;
  spotOnly?: boolean;
};

export async function resolvePreviewUniverseSnapshot(
  options: PreviewUniverseOptions = {}
): Promise<PreviewUniverseSnapshot> {
  const quote = normalizeQuote(options.quote);
  const spotOnly = options.spotOnly !== false;

  const {
    coins: previewCoins,
    symbols: previewSymbols,
    cached,
    updatedAt,
    note,
  } = await getBinancePreviewCoins({ quote, spotOnly });

  const previewCoinSet = new Set(previewCoins.map(toUpper));
  const previewSymbolSet = new Set(previewSymbols.map(toUpper));

  const settingsCoins = await resolveCoinsFromSettings();

  const coins = settingsCoins
    .map(toUpper)
    .filter((coin) => previewCoinSet.has(coin));

  if (previewCoinSet.has(quote) && !coins.includes(quote)) {
    coins.unshift(quote);
  }

  const derivedSymbols = coins
    .filter((coin) => coin && coin !== quote)
    .map((coin) => `${coin}${quote}`)
    .filter((symbol) => previewSymbolSet.has(symbol));

  return {
    quote,
    previewCoins,
    previewSymbols,
    settingsCoins,
    coins: Array.from(new Set(coins)),
    symbols: Array.from(new Set(derivedSymbols)),
    cached,
    updatedAt,
    note,
  };
}
