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

export async function verifyBinanceAccount(apiKey: string, apiSecret: string): Promise<VerifyResponse> {
  try {
    const timestamp = Date.now();
    const query = new URLSearchParams({ timestamp: String(timestamp) }).toString();
    const signature = crypto.createHmac("sha256", apiSecret).update(query).digest("hex");

    const url = `https://api.binance.com/api/v3/account?${query}&signature=${signature}`;
    const res = await fetch(url, {
      headers: { "X-MBX-APIKEY": apiKey },
      cache: "no-store",
    });

    const text = await res.text();
    let json: unknown;
    try {
      json = text ? JSON.parse(text) : undefined;
    } catch {
      json = undefined;
    }

    if (!res.ok) {
      const errorMessage =
        (json && typeof json === "object" ? (json as { msg?: string }).msg : undefined)
        || text
        || "Request failed";
      return { ok: false, status: res.status, error: errorMessage };
    }

    const body = (json && typeof json === "object") ? (json as Record<string, unknown>) : {};
    const balances = Array.isArray(body.balances as unknown[]) ? (body.balances as unknown[]).length : 0;

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

