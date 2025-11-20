import { query } from "@/core/db/pool_server";

type SnapshotMeta = {
  provider?: string;
  owner?: string | null;
};

const DEFAULT_META = "{}";

export async function persistWalletSnapshot(
  wallets: Record<string, number | null | undefined> | undefined,
  meta?: SnapshotMeta
) {
  if (!wallets) return { persisted: 0 };
  const entries = Object.entries(wallets).filter(
    ([asset, value]) => asset && Number.isFinite(Number(value))
  );
  if (!entries.length) return { persisted: 0 };

  const assets: string[] = [];
  const freeAmounts: number[] = [];
  const lockedAmounts: number[] = [];
  for (const [asset, value] of entries) {
    const normalized = String(asset ?? "").trim().toUpperCase();
    if (!normalized) continue;
    assets.push(normalized);
    freeAmounts.push(Number(value));
    lockedAmounts.push(0);
  }
  if (!assets.length) return { persisted: 0 };

  const metaPayload =
    meta && (meta.provider || meta.owner)
      ? JSON.stringify({
          ...(meta.provider ? { provider: meta.provider } : {}),
          ...(meta.owner ? { owner: meta.owner } : {}),
        })
      : DEFAULT_META;

  await query(
    `SELECT market.upsert_wallet_balance(t.asset, t.free_amt, t.locked_amt, $4::jsonb)
       FROM unnest($1::text[], $2::numeric[], $3::numeric[]) AS t(asset, free_amt, locked_amt)`,
    [assets, freeAmounts, lockedAmounts, metaPayload]
  );

  return { persisted: assets.length };
}
