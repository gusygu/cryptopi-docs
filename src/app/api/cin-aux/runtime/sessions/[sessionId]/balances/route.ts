import { NextRequest, NextResponse } from "next/server";
import {
  fetchRuntimeAssets,
  fetchRuntimeSessionSummary,
  fetchUniverseBaseAssets,
} from "@/core/features/cin-aux/runtimeQueries";
import { getAccountBalances } from "@/core/sources/binanceAccount";
import { getCurrentUser } from "@/lib/auth/server";

type RuntimeAssetResponse = Awaited<ReturnType<typeof fetchRuntimeAssets>>[number];

export async function GET(
  _req: NextRequest,
  ctx: { params: { sessionId: string } },
) {
  const idRaw = ctx.params.sessionId;
  const sessionId = /^\d+$/.test(idRaw) ? Number(idRaw) : NaN;

  if (!Number.isFinite(sessionId)) {
    return NextResponse.json({ error: "invalid session id" }, { status: 400 });
  }

  try {
    const user = await getCurrentUser().catch(() => null);
    const walletEmail = user?.email?.toLowerCase() ?? null;

    const [session, assetsRaw, universe, accountBalances] = await Promise.all([
      fetchRuntimeSessionSummary(sessionId),
      fetchRuntimeAssets(sessionId),
      fetchUniverseBaseAssets(),
      getAccountBalances(walletEmail ? { email: walletEmail } : undefined).catch(
        () => ({}),
      ),
    ]);

    if (!session) {
      return NextResponse.json({ session: null, assets: [] });
    }

    const safeBalances = (accountBalances ?? {}) as Record<string, number>;
    const liveEntries = Object.entries(safeBalances).map(
      ([asset, units]) => [asset.toUpperCase(), Number(units) || 0] as const,
    );
    const liveMap = new Map(liveEntries.filter(([, units]) => units > 0));

    const assetMap = new Map<string, RuntimeAssetResponse>();

    for (const asset of assetsRaw) {
      const key = asset.assetId.toUpperCase();
      const existing = assetMap.get(key);
      if (!existing) {
        assetMap.set(key, { ...asset, assetId: key, accountUnits: asset.accountUnits ?? null });
      } else if (existing.accountUnits == null && asset.accountUnits != null) {
        assetMap.set(key, { ...existing, accountUnits: asset.accountUnits });
      }
      const liveUnits = liveMap.get(key);
      if (liveUnits != null) {
        assetMap.set(key, {
          ...(assetMap.get(key) || { ...asset, assetId: key }),
          accountUnits: liveUnits,
        });
        liveMap.delete(key);
      }
    }

    for (const [assetId, units] of liveMap.entries()) {
      if (!universe.has(assetId)) continue;
      if (assetMap.has(assetId)) {
        const current = assetMap.get(assetId)!;
        assetMap.set(assetId, { ...current, accountUnits: units });
        continue;
      }
      assetMap.set(assetId, {
        sessionId,
        assetId,
        openingPrincipal: "0",
        openingProfit: "0",
        principalUsdt: "0",
        profitUsdt: "0",
        lastMarkTs: null,
        priceUsdt: null,
        bulkUsdt: "0",
        mtmValueUsdt: "0",
        weightInPortfolio: null,
        realizedPnlUsdt: null,
        inUniverse: true,
        referenceUsdt: null,
        accountUnits: units,
      });
    }

    const assets = Array.from(assetMap.values());

    assets.sort((a, b) => {
      const mtmDiff =
        Number(b.mtmValueUsdt ?? 0) - Number(a.mtmValueUsdt ?? 0);
      if (mtmDiff !== 0 && Number.isFinite(mtmDiff)) return mtmDiff;
      const walletDiff = (b.accountUnits ?? 0) - (a.accountUnits ?? 0);
      if (walletDiff !== 0) return walletDiff;
      return a.assetId.localeCompare(b.assetId);
    });

    return NextResponse.json({ session, assets });
  } catch (err) {
    console.error("[cin-aux runtime balances] error", err);
    return NextResponse.json(
      { error: "cin runtime balances failed" },
      { status: 500 },
    );
  }
}
