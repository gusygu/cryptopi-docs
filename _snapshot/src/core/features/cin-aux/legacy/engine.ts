import type { SessionId, Asset } from "./service";
import {
  execMoveV2, getBalances, upsertReference, markBulk, closeSession, hasLots
} from "./service";

export type Pricing = Record<Asset, number>; // USDT per unit

export function planAgainstRef(refUSDT: number | null | undefined, availableUSDT: number) {
  const ref = Math.max(0, Number(refUSDT ?? 0));
  const planned = Math.min(ref, Math.max(0, Number(availableUSDT)));
  return { refTargetUSDT: ref || null, plannedUSDT: planned };
}

export async function availableUSDT(sessionId: SessionId, from: Asset): Promise<number> {
  const bals = await getBalances(sessionId);
  const row = bals.find(b => b.asset_id === from);
  if (!row) return 0;
  return Number(row.principal_usdt ?? 0) + Number(row.profit_usdt ?? 0);
}

export async function hop(opts: {
  sessionId: SessionId;
  ts: Date;
  from: Asset;
  to: Asset;
  executedUSDT: number;
  feesUSDT?: number;
  slippageUSDT?: number;
  prices: Pricing;
  refUSDT?: number | null;
}) {
  const avail = await availableUSDT(opts.sessionId, opts.from);
  const { refTargetUSDT, plannedUSDT } = planAgainstRef(opts.refUSDT ?? null, avail);

  // Only consume lots (set priceBridgeUSDT) if the FROM asset actually has lots.
  const bridgePrice = (await hasLots(opts.sessionId, opts.from))
    ? (opts.prices[opts.from] ?? null)
    : null;

  return execMoveV2({
    sessionId: opts.sessionId,
    ts: opts.ts,
    from: opts.from,
    to: opts.to,
    executedUSDT: opts.executedUSDT,
    feeUSDT: opts.feesUSDT ?? 0,
    slippageUSDT: opts.slippageUSDT ?? 0,
    refTargetUSDT,
    plannedUSDT,
    availableUSDT: avail,
    priceFromUSDT:  opts.prices[opts.from] ?? null,
    priceToUSDT:    opts.prices[opts.to]   ?? null,
    priceBridgeUSDT: bridgePrice,
  });
}

export async function setRef(sessionId: SessionId, asset: Asset, usdt: number, sourceTag = "MEA*mood") {
  await upsertReference(sessionId, asset, usdt, sourceTag);
}

export async function sealWithMarks(sessionId: SessionId, marks: Array<{ asset: Asset; bulkUSDT: number; ts?: Date }>) {
  for (const m of marks) {
    await markBulk(sessionId, m.asset, m.ts ?? new Date(), m.bulkUSDT);
  }
  await closeSession(sessionId);
}
