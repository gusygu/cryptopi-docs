// src/core/features/cin-aux/stream.ts
import { db } from "@/core/db/db";

/** ---------- flow (compiler + coordinator fused) ---------- */
export type FlowNodeId = string;
export type FlowNode = {
  id: FlowNodeId;
  kind: "source" | "transform" | "sink";
  run: (ctx: any) => Promise<any>;
  deps?: FlowNodeId[];
};
export type FlowGraph = { nodes: Record<FlowNodeId, FlowNode> };

export async function runFlow(graph: FlowGraph, ctx: any) {
  const order = topo(graph);
  for (const id of order) {
    const node = graph.nodes[id];
    const out = await node.run(ctx);
    ctx[id] = out;
  }
  return ctx;
}
function topo(graph: FlowGraph): FlowNodeId[] {
  const out: FlowNodeId[] = [], temp = new Set<FlowNodeId>(), perm = new Set<FlowNodeId>();
  const visit = (id: FlowNodeId) => {
    if (perm.has(id)) return;
    if (temp.has(id)) throw new Error(`cycle at ${id}`);
    temp.add(id);
    for (const d of graph.nodes[id].deps ?? []) visit(d);
    perm.add(id); temp.delete(id); out.push(id);
  };
  for (const id of Object.keys(graph.nodes)) visit(id);
  return out;
}

/** ---------- ledger (write + read + latest ctx) ---------- */
export type LedgerEntry = {
  appSessionId: string;
  cycleTs: number;
  legSeq: number;
  fromSymbol: string;
  toSymbol: string;
  qtyFrom: number;
  qtyTo: number;
  priceFromUsdt: number;
  priceToUsdt: number;
  feeUsdt?: number;
  execTs: number;
  routeId?: string;
  intentId?: string;
  txId?: string | null;
};

export async function insertLedgerEntries(entries: LedgerEntry[]) {
  if (!entries.length) return;
  const text =
    `insert into transfer_ledger
      (app_session_id, cycle_ts, leg_seq, route_id, intent_id,
       from_symbol, to_symbol, qty_from, qty_to,
       price_from_usdt, price_to_usdt, fee_usdt, exec_ts, tx_id)
     values ` +
    entries.map((_, i) => {
      const b = i * 14;
      return `($${b+1}, $${b+2}, $${b+3}, $${b+4}, $${b+5},
               $${b+6}, $${b+7}, $${b+8}, $${b+9},
               $${b+10}, $${b+11}, $${b+12}, $${b+13}, $${b+14})`;
    }).join(',') +
    ` on conflict (app_session_id, cycle_ts, leg_seq)
        do update set
          qty_from = excluded.qty_from,
          qty_to = excluded.qty_to,
          price_from_usdt = excluded.price_from_usdt,
          price_to_usdt = excluded.price_to_usdt,
          fee_usdt = excluded.fee_usdt,
          exec_ts = excluded.exec_ts,
          route_id = excluded.route_id,
          intent_id = excluded.intent_id,
          tx_id = excluded.tx_id`;
  const values = entries.flatMap(e => [
    e.appSessionId, e.cycleTs, e.legSeq, e.routeId || null, e.intentId || null,
    e.fromSymbol, e.toSymbol, e.qtyFrom, e.qtyTo,
    e.priceFromUsdt, e.priceToUsdt, e.feeUsdt ?? 0, e.execTs, e.txId || null,
  ]);
  await db.query(text, values);
}

export async function readFlowLedger(appSessionId: string, limit = 50) {
  try {
    const { rows } = await db.query(
      `SELECT ts_ms, payload FROM cin_flow_ledger
       WHERE app_session_id=$1 ORDER BY ts_ms DESC LIMIT $2`,
      [appSessionId, limit]
    );
    return rows;
  } catch { return []; }
}

export async function getLatestFlowCtx(appSessionId: string): Promise<any | null> {
  try {
    const { rows } = await db.query(
      `SELECT payload
         FROM cin_flow_ledger
        WHERE app_session_id=$1
     ORDER BY ts_ms DESC
        LIMIT 1`,
      [appSessionId]
    );
    return rows.length ? rows[0].payload : null;
  } catch { return null; }
}

/** ---------- optional demo: compile + run routes for a cycle ---------- */
export type RouteIntent = {
  appSessionId: string;
  cycleTs: number;
  routeId: string;
  legs: Array<{ from: string; to: string }>;
};

/** toy compiler: chain two bullish symbols via USDT if id_pct>0 */
export async function compileRoutes(appSessionId: string, cycleTs: number): Promise<RouteIntent[]> {
  const { rows } = await db.query<{ symbol: string; id_pct: number }>(
    `select symbol, id_pct from mea_unified_refs where cycle_ts = $1`,
    [cycleTs]
  );
  const bullish = rows.filter(r => (r.id_pct ?? 0) > 0).map(r => r.symbol);
  if (bullish.length < 2) return [];
  const s1 = bullish[0], s2 = bullish[1];
  return [{
    appSessionId, cycleTs,
    routeId: `rt-${cycleTs}-${s1}-${s2}`,
    legs: [{ from: s1, to: 'USDT' }, { from: 'USDT', to: s2 }],
  }];
}

/** toy coordinator: simulate fills from prices_usdt and write ledger */
export async function runRoutes(intents: RouteIntent[]) {
  for (const intent of intents) {
    let legSeq = 1;
    for (const leg of intent.legs) {
      const pf = await priceAt(intent.cycleTs, leg.from);
      const pt = await priceAt(intent.cycleTs, leg.to);
      if (!pf || !pt) continue;

      const qtyFrom = 0.1;
      const qtyTo   = (qtyFrom * pf) / pt;
      const feeUsdt = 0;

      await insertLedgerEntries([{
        appSessionId: intent.appSessionId,
        cycleTs: intent.cycleTs,
        legSeq,
        fromSymbol: leg.from,
        toSymbol: leg.to,
        qtyFrom,
        qtyTo,
        priceFromUsdt: pf,
        priceToUsdt: pt,
        feeUsdt,
        execTs: Date.now(),
        routeId: intent.routeId,
        intentId: intent.routeId,
        txId: null,
      }]);
      legSeq++;
    }
  }
}

async function priceAt(cycleTs: number, symbol: string): Promise<number> {
  const { rows } = await db.query<{ price_usdt: number }>(
    `select price_usdt from prices_usdt where cycle_ts=$1 and symbol=$2`,
    [cycleTs, symbol]
  );
  return Number(rows[0]?.price_usdt ?? 0);
}
