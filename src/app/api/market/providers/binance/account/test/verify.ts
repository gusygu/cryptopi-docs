import crypto from "crypto";

export type VerifyResponse = {
  ok: boolean;
  accountType?: string | null;
  canTrade?: boolean;
  balancesCount?: number;
  updateTime?: number | null;
  status?: number;
  error?: string;
};

type RawAccount = Record<string, unknown> & { balances?: unknown[] };

async function fetchServerTime(): Promise<number> {
  const res = await fetch("https://api.binance.com/api/v3/time", {
    cache: "no-store",
  });
  if (!res.ok) {
    throw new Error(`Failed to fetch Binance server time (HTTP ${res.status})`);
  }
  const data = (await res.json()) as { serverTime?: number };
  return Number(data?.serverTime ?? Date.now());
}

type RequestResult =
  | { ok: true; body: RawAccount }
  | { ok: false; status: number; error: string; code?: number };

async function requestAccount(
  apiKey: string,
  apiSecret: string,
  skewMs = 0,
): Promise<RequestResult> {
  const timestamp = Date.now() + skewMs;
  const query = new URLSearchParams({ timestamp: String(timestamp) }).toString();
  const signature = crypto.createHmac("sha256", apiSecret).update(query).digest("hex");

  const url = `https://api.binance.com/api/v3/account?${query}&signature=${signature}`;
  const res = await fetch(url, {
    headers: { "X-MBX-APIKEY": apiKey },
    cache: "no-store",
  });

  const text = await res.text();
  let json: any;
  try {
    json = text ? JSON.parse(text) : undefined;
  } catch {
    json = undefined;
  }

  if (!res.ok) {
    const message =
      (json && typeof json === "object" ? json.msg : undefined) ||
      text ||
      `HTTP ${res.status}`;
    return {
      ok: false,
      status: res.status,
      error: message,
      code: typeof json?.code === "number" ? json.code : undefined,
    };
  }

  return {
    ok: true,
    body: (json && typeof json === "object" ? (json as RawAccount) : {}) ?? {},
  };
}

export async function verifyBinanceAccount(
  apiKey: string,
  apiSecret: string,
): Promise<VerifyResponse> {
  try {
    let attempt = await requestAccount(apiKey, apiSecret);

    if (!attempt.ok && (attempt.code === -1021 || /timestamp/i.test(attempt.error))) {
      const serverTime = await fetchServerTime();
      const skew = serverTime - Date.now();
      attempt = await requestAccount(apiKey, apiSecret, skew);
    }

    if (!attempt.ok) {
      return {
        ok: false,
        status: attempt.status,
        error: attempt.error,
      };
    }

    const body = attempt.body;
    const balances = Array.isArray(body.balances) ? body.balances.length : 0;

    return {
      ok: true,
      accountType: typeof body.accountType === "string" ? body.accountType : null,
      canTrade: Boolean(body.canTrade),
      balancesCount: balances,
      updateTime: typeof body.updateTime === "number" ? body.updateTime : null,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error ?? "Unexpected error");
    return { ok: false, error: message };
  }
}

