import { resolveCoinsFromSettings } from "@/lib/settings/server";
import {
  dedupeCoins,
  normalizeCoin,
  usdtLegsFromCoins,
} from "@/lib/markets/pairs";

const KNOWN_QUOTES = ["USDT","BTC","ETH","BNB","BUSD","FDUSD","USDC","TUSD"] as const;

type KnownQuote = (typeof KNOWN_QUOTES)[number];

const DEFAULT_FALLBACK_BASES = ["BTC","ETH","BNB","SOL","ADA","XRP","DOGE"];

export type SymbolSource =
  | "query"
  | "settings"
  | "settings_symbols"
  | "preview"
  | "env"
  | "fallback";

export type SymbolSelection = {
  bases: string[];
  defaults: string[];
  extras: string[];
  explicit: string[];
  symbols: string[];
  quote: string;
  quotes: string[];
  source: SymbolSource;
};

const sanitizeSymbol = (value: unknown): string => {
  if (typeof value !== "string") return "";
  const raw = value.trim().toUpperCase();
  if (!raw) return "";
  return /^[A-Z0-9]{5,20}$/.test(raw) ? raw : "";
};

function parseList(values: string[]): string[] {
  const out: string[] = [];
  for (const value of values) {
    if (!value) continue;
    for (const token of value.split(",")) {
      const trimmed = token.trim();
      if (trimmed) out.push(trimmed);
    }
  }
  return out;
}

function collectQueryValues(url: URL, keys: string[]): string[] {
  const collected: string[] = [];
  for (const key of keys) {
    const values = url.searchParams.getAll(key);
    if (!values.length) continue;
    collected.push(...parseList(values));
  }
  return collected;
}

async function getPreviewSymbols(origin: string): Promise<string[]> {
  try {
    const response = await fetch(`${origin}/api/preview/symbols`, { cache: "no-store" });
    if (!response.ok) return [];
    const payload = (await response.json()) as any;
    return Array.isArray(payload?.symbols)
      ? payload.symbols.map((s: unknown) => String(s ?? "").trim().toUpperCase())
      : [];
  } catch {
    return [];
  }
}

async function getSettingsSymbols(origin: string): Promise<string[]> {
  try {
    const response = await fetch(`${origin}/api/preview/universe/symbols`, { cache: "no-store" });
    if (!response.ok) return [];
    const payload = (await response.json()) as any;
    return Array.isArray(payload?.symbols)
      ? payload.symbols.map((s: unknown) => String(s ?? "").trim().toUpperCase())
      : [];
  } catch {
    return [];
  }
}

export function splitSymbol(
  symbol: string,
  fallbackQuote: KnownQuote | string = "USDT"
): { base: string; quote: string } {
  const value = String(symbol ?? "").trim().toUpperCase();
  if (!value) return { base: "", quote: fallbackQuote };
  for (const quote of KNOWN_QUOTES) {
    if (value.endsWith(quote) && value.length > quote.length) {
      return { base: value.slice(0, -quote.length), quote };
    }
  }
  if (fallbackQuote && value.endsWith(fallbackQuote) && value.length > fallbackQuote.length) {
    return { base: value.slice(0, -fallbackQuote.length), quote: fallbackQuote };
  }
  return { base: value.replace(/USDT$/i, ""), quote: fallbackQuote };
}

async function resolveBases(
  origin: string,
  quote: string
): Promise<{ bases: string[]; source: SymbolSource }> {
  const fromSettings = dedupeCoins(await resolveCoinsFromSettings()).filter(
    (coin) => coin && coin !== quote
  );
  if (fromSettings.length) {
    return { bases: fromSettings, source: "settings" };
  }

  const settingsSymbols = await getSettingsSymbols(origin);
  if (settingsSymbols.length) {
    const bases = dedupeCoins(
      settingsSymbols.map((symbol) => splitSymbol(symbol, quote).base)
    ).filter((coin) => coin && coin !== quote);
    if (bases.length) {
      return { bases, source: "settings_symbols" };
    }
  }

  const previewSymbols = await getPreviewSymbols(origin);
  if (previewSymbols.length) {
    const bases = dedupeCoins(
      previewSymbols.map((symbol) => splitSymbol(symbol, quote).base)
    ).filter((coin) => coin && coin !== quote);
    if (bases.length) {
      return { bases, source: "preview" };
    }
  }

  const env = String(process.env.NEXT_PUBLIC_COINS ?? "")
    .trim()
    .toUpperCase();
  if (env) {
    const bases = dedupeCoins(env.split(/[\s,]+/g).filter(Boolean)).filter(
      (coin) => coin && coin !== quote
    );
    if (bases.length) {
      return { bases, source: "env" };
    }
  }

  const fallback = dedupeCoins(DEFAULT_FALLBACK_BASES).filter(
    (coin) => coin && coin !== quote
  );
  return { bases: fallback, source: "fallback" };
}

function buildDefaults(bases: string[], quote: string): string[] {
  const sanitizedQuote = normalizeCoin(quote) || "USDT";
  if (sanitizedQuote === "USDT") {
    return usdtLegsFromCoins(bases);
  }
  return bases
    .map((base) => normalizeCoin(base))
    .filter((base) => base && base !== sanitizedQuote)
    .map((base) => `${base}${sanitizedQuote}`);
}

function dedupePreserveOrder(items: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of items) {
    const key = item.toUpperCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

function sanitizeSymbols(values: string[]): string[] {
  return dedupePreserveOrder(
    values
      .map((value) => sanitizeSymbol(value))
      .filter((value) => Boolean(value))
  );
}

function sanitizeBases(values: string[]): string[] {
  return dedupeCoins(values.map((value) => normalizeCoin(value))).filter(Boolean);
}

export async function resolveSymbolSelection(
  url: URL,
  opts?: { quote?: string }
): Promise<SymbolSelection> {
  const quote = (opts?.quote ?? "USDT").toUpperCase();

  const baseTokens = collectQueryValues(url, ["bases", "base"]);
  const explicitBases = sanitizeBases(baseTokens).filter((coin) => coin !== quote);
  const hasQueryBases = explicitBases.length > 0;

  const baseUniverse = hasQueryBases
    ? { bases: explicitBases, source: "query" as SymbolSource }
    : await resolveBases(url.origin, quote);

  const defaults = buildDefaults(baseUniverse.bases, quote);

  const extraTokens = collectQueryValues(url, ["extra", "extras", "include"]);
  const extras = sanitizeSymbols(extraTokens);

  const symbolTokens = collectQueryValues(url, ["symbols", "symbol"]);
  const explicit = sanitizeSymbols(symbolTokens);

  const symbols = explicit.length
    ? explicit
    : dedupePreserveOrder([...defaults, ...extras]);

  const quotes = dedupePreserveOrder(
    symbols
      .map((symbol) => splitSymbol(symbol, quote).quote)
      .filter(Boolean)
  );

  return {
    bases: baseUniverse.bases,
    defaults,
    extras,
    explicit,
    symbols,
    quote,
    quotes,
    source: baseUniverse.source,
  };
}

export { KNOWN_QUOTES };
