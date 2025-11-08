// src/lib/settings/store.ts
// Dev settings store (in-memory). Swap with Prisma later.
// WARNING: process-memory persistence — OK for dev, not for prod.

export type Profile = {
  nickname?: string;
  timezone?: string; // e.g., "America/Sao_Paulo"
  language?: string; // e.g., "en", "pt-BR"
};

export type Wallet = {
  id: string;           // uuid
  label?: string;       // "Main Binance", "Cold", etc
  symbol: string;       // "BTC", "ETH", "USDT"
  network?: string;     // "ERC20", "TRC20", "BEP20", "SOL", "BTC"
  address: string;      // public address (never private keys)
};

export type Params = {
  coinUniverse: string[];      // e.g., ["BTC","ETH","BNB","SOL","USDT"]
  cadenceSec: number;          // poll cadence
  kSize: number;               // K cycles / window size
  idPctAmber: number;          // amber threshold (abs)
  idPctHighlight: number;      // highlight threshold (abs)
  drvSensitivity: number;      // tendency sensitivity
  flipRings: boolean;          // show flip rings
  previewRings: boolean;       // show preview rings
};

export type UserSettings = {
  profile: Profile;
  wallets: Wallet[];
  params: Params;
  updatedAt: number;
};

const DEFAULTS: UserSettings = {
  profile: {
    nickname: "",
    timezone: "America/Sao_Paulo",
    language: "en",
  },
  wallets: [],
  params: {
    coinUniverse: ["BTC", "ETH", "BNB", "SOL", "USDT"],
    cadenceSec: 40,
    kSize: 9,
    idPctAmber: 0.000020,      // 0.0020%
    idPctHighlight: 0.000200,  // 0.0200%
    drvSensitivity: 1.0,
    flipRings: true,
    previewRings: true,
  },
  updatedAt: Date.now(),
};

// Dev in-memory DB keyed by user email
const DB = new Map<string, UserSettings>();

function clone<T>(x: T): T {
  return JSON.parse(JSON.stringify(x));
}

export function getUserSettings(email: string): UserSettings {
  const key = email.toLowerCase();
  const cur = DB.get(key);
  if (!cur) {
    const seeded = clone(DEFAULTS);
    DB.set(key, seeded);
    return clone(seeded);
  }
  return clone(cur);
}

export function setUserSettings(email: string, patch: Partial<UserSettings>): UserSettings {
  const key = email.toLowerCase();
  const current = getUserSettings(key);
  const merged: UserSettings = {
    profile: { ...current.profile, ...patch.profile },
    wallets: Array.isArray(patch.wallets) ? patch.wallets : current.wallets,
    params: { ...current.params, ...patch.params },
    updatedAt: Date.now(),
  };
  DB.set(key, clone(merged));
  return getUserSettings(key);
}

export function replaceUserSettings(email: string, data: UserSettings): void {
  const key = email.toLowerCase();
  const next = { ...data, updatedAt: Date.now() };
  DB.set(key, clone(next));
}

export function upsertWallet(email: string, w: Wallet): UserSettings {
  const s = getUserSettings(email);
  const idx = s.wallets.findIndex((x) => x.id === w.id);
  if (idx >= 0) s.wallets[idx] = w; else s.wallets.push(w);
  return setUserSettings(email, { wallets: s.wallets });
}

export function removeWallet(email: string, walletId: string): UserSettings {
  const s = getUserSettings(email);
  const next = s.wallets.filter((w) => w.id !== walletId);
  return setUserSettings(email, { wallets: next });
}
