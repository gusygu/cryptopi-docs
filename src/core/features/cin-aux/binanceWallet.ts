// src/core/features/cin-aux/binanceWallet.ts
import crypto from "crypto";

const BINANCE_API_KEY = process.env.BINANCE_API_KEY!;
const BINANCE_API_SECRET = process.env.BINANCE_API_SECRET!;
const BINANCE_BASE_URL = "https://api.binance.com";

interface BinanceBalance {
  asset: string;
  free: string;
  locked: string;
}

export async function fetchBinanceSpotBalances(): Promise<BinanceBalance[]> {
  if (!BINANCE_API_KEY || !BINANCE_API_SECRET) {
    throw new Error("Binance API credentials not configured");
  }

  const timestamp = Date.now();
  const query = `timestamp=${timestamp}`;
  const signature = crypto
    .createHmac("sha256", BINANCE_API_SECRET)
    .update(query)
    .digest("hex");

  const url = `${BINANCE_BASE_URL}/api/v3/account?${query}&signature=${signature}`;

  const res = await fetch(url, {
    method: "GET",
    headers: {
      "X-MBX-APIKEY": BINANCE_API_KEY,
    },
  });

  if (!res.ok) {
    throw new Error(`Binance account HTTP ${res.status}`);
  }

  const json: any = await res.json();
  const balances = (json.balances ?? []) as BinanceBalance[];
  return balances;
}
