// src/lib/wallet/registry.ts
// In-memory registry that maps user emails to Binance API credentials.

export type WalletRecord = {
  email: string;
  apiKey: string;
  apiSecret: string;
  linkedAt: number;
};

type WalletMap = Map<string, WalletRecord>;

const GLOBAL_KEY = "__cryptopi_wallet_registry__";
const globalObject = globalThis as unknown as { [GLOBAL_KEY]?: WalletMap };

if (!globalObject[GLOBAL_KEY]) {
  globalObject[GLOBAL_KEY] = new Map();
}

const registry = globalObject[GLOBAL_KEY]!;

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function getWallet(email: string): WalletRecord | null {
  return registry.get(normalizeEmail(email)) ?? null;
}

export function setWallet(email: string, record: Omit<WalletRecord, "email">): WalletRecord {
  const normalized = normalizeEmail(email);
  const entry: WalletRecord = {
    email: normalized,
    apiKey: record.apiKey,
    apiSecret: record.apiSecret,
    linkedAt: record.linkedAt ?? Date.now(),
  };
  registry.set(normalized, entry);
  return entry;
}

export function deleteWallet(email: string) {
  registry.delete(normalizeEmail(email));
}

export function maskKey(apiKey: string): string {
  if (apiKey.length <= 8) return apiKey;
  return `${apiKey.slice(0, 4)}…${apiKey.slice(-4)}`;
}

export function listWallets(): WalletRecord[] {
  return Array.from(registry.values());
}

