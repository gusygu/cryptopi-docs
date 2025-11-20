import "dotenv/config";
import { describe, it, expect } from "vitest";
import { GET as samplingGET } from "@/app/api/str-aux/sources/ingest/sampling/route";

const hasDb = Boolean(process.env.DATABASE_URL);
const SYMBOLS = (process.env.TEST_SAMPLING_SYMBOLS ??
  process.env.SYMBOLS ??
  process.env.SYMBOL ??
  "BTCUSDT,ETHUSDT")
  .split(",")
  .map((s) => s.trim().toUpperCase())
  .filter(Boolean);

describe.skipIf(!hasDb)("str-aux sampling smoke", () => {
  it("returns recent 5s buckets with density metadata", async () => {
    for (const symbol of SYMBOLS) {
      const url = new URL("http://local.test/api/str-aux/sources/ingest/sampling");
      url.searchParams.set("symbol", symbol);
      url.searchParams.set("limit", String(Number(process.env.TEST_SAMPLING_LIMIT ?? 20)));
      url.searchParams.set("latest", "true");

      const res = await samplingGET(new Request(url.toString()));
      expect(res.ok).toBe(true);
      const body = (await res.json()) as { ok: boolean; rows?: any[] };
      expect(body.ok).toBe(true);
      expect(Array.isArray(body.rows)).toBe(true);
      const rows = body.rows ?? [];
      if (!rows.length) {
        console.warn(`[sampling smoke] no rows returned for ${symbol}, skipping assertions.`);
        continue;
      }

      const sample = rows[0];
      expect(sample.symbol?.toUpperCase?.()).toBe(symbol);
      if (sample.bucket_count != null) {
        expect(Number(sample.bucket_count)).toBeGreaterThanOrEqual(0);
      }
      expect(Array.isArray(sample.quality_flags ?? [])).toBe(true);
      expect(sample.attrs).toBeDefined();
    }
  });
});
