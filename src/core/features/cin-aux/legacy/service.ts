import { sql } from "../../../../../legacy/opening";

// ——— types ———
export type SessionId = number;
export type Asset = string;

// ——— sessions ———
export async function openSession(windowLabel: string): Promise<SessionId> {
  const rows = await sql<{ session_id: number }>`
    insert into strategy_aux.cin_session(window_label)
    values (${windowLabel}) returning session_id
  `;
  return rows[0].session_id;
}

// closeSessionV2 is the real db func; we also expose closeSession as an alias.
export async function closeSessionV2(sessionId: SessionId) {
  await sql`select strategy_aux.cin_close_session_v2(${sessionId})`;
}
export async function closeSession(sessionId: SessionId) {
  return closeSessionV2(sessionId);
}

// ——— references (MEA·mood) ———
export async function upsertReference(sessionId: SessionId, asset: Asset, refUSDT: number, sourceTag = "MEA*mood") {
  await sql`
    insert into strategy_aux.cin_reference(session_id, asset_id, ref_usdt, source_tag)
    values (${sessionId}, ${asset}, ${refUSDT}, ${sourceTag})
    on conflict (session_id, asset_id)
    do update set ref_usdt = excluded.ref_usdt, source_tag = excluded.source_tag
  `;
}
// “setRef” alias if you prefer that name elsewhere
export async function setReference(sessionId: SessionId, asset: Asset, refUSDT: number, sourceTag = "MEA*mood") {
  return upsertReference(sessionId, asset, refUSDT, sourceTag);
}

// ——— balances ———
export async function seedBalance(sessionId: SessionId, asset: Asset, openingPrincipalUSDT: number) {
  await sql`
    insert into strategy_aux.cin_balance(session_id, asset_id, opening_principal, opening_profit, principal_usdt, profit_usdt)
    values (${sessionId}, ${asset}, ${openingPrincipalUSDT}, 0, ${openingPrincipalUSDT}, 0)
    on conflict (session_id, asset_id) do nothing
  `;
}

export async function getBalances(sessionId: SessionId) {
  return sql`
    select asset_id, opening_principal, opening_profit, principal_usdt, profit_usdt, closing_principal, closing_profit
    from strategy_aux.cin_balance
    where session_id=${sessionId}
    order by asset_id
  `;
}

// ——— marks ———
export async function markBulk(sessionId: SessionId, asset: Asset, ts: Date, bulkUSDT: number) {
  await sql`
    insert into strategy_aux.cin_mark(session_id, asset_id, ts, bulk_usdt)
    values (${sessionId}, ${asset}, ${ts}, ${bulkUSDT})
  `;
}

// ——— moves ———
export async function execMoveV2(args: {
  sessionId: SessionId; ts: Date; from: Asset; to: Asset;
  executedUSDT: number; feeUSDT?: number; slippageUSDT?: number;
  refTargetUSDT?: number | null; plannedUSDT?: number | null; availableUSDT?: number | null;
  priceFromUSDT?: number | null; priceToUSDT?: number | null; priceBridgeUSDT?: number | null;
}): Promise<number> {
  const rows = await sql<{ move_id: number }>`
    select strategy_aux.cin_exec_move_v2(
      ${args.sessionId}, ${args.ts}, ${args.from}, ${args.to},
      ${args.executedUSDT}, ${args.feeUSDT ?? 0}, ${args.slippageUSDT ?? 0},
      ${args.refTargetUSDT ?? null}, ${args.plannedUSDT ?? null}, ${args.availableUSDT ?? null},
      ${args.priceFromUSDT ?? null}, ${args.priceToUSDT ?? null},
      ${args.priceBridgeUSDT ?? null}
    ) as move_id
  `;
  return rows[0].move_id;
}

export async function getMoves(sessionId: SessionId) {
  return sql`
    select * from strategy_aux.cin_move
    where session_id=${sessionId}
    order by move_id
  `;
}

export async function getRollup(sessionId: SessionId) {
  const rows = await sql`
    select * from strategy_aux.cin_imprint_luggage where session_id=${sessionId}
  `;
  return rows[0] ?? null;
}

// ——— helper: does the source asset have lots to consume? ———
export async function hasLots(sessionId: SessionId, asset: Asset): Promise<boolean> {
  const rows = await sql`select 1
                         from strategy_aux.cin_lot
                         where session_id=${sessionId}
                           and asset_id=${asset}
                           and units_free > 0
                         limit 1`;
  return rows.length > 0;
}
