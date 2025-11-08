// app/api/ops/place/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { pool } from '@/lib/db.server';

export async function POST(req: NextRequest) {
  const b = await req.json();
  const { session_id, symbol, side, qty, px, kind='market', paper=true } = b;
  if (!session_id || !symbol || !side || !qty) return NextResponse.json({error:'missing fields'},{status:400});

  const { rows: [ord] } = await pool.query(
    `insert into ops_order(session_id, symbol, side, qty, px, kind, paper)
     values ($1,$2,$3,$4,$5,$6,$7) returning *`,
     [session_id, symbol, side, qty, px ?? null, kind, paper]);

  // paper fill at px or last vector mid proxy
  let fillPx = px ?? null;
  if (!fillPx) {
    const { rows: [v] } = await pool.query(
      `select (v_outer + v_inner/2.0) as guess from str_vectors where session_id=$1 and symbol=$2
       order by created_at desc limit 1`, [session_id, symbol]);
    fillPx = Number(v?.guess ?? 0) || 0;
  }
  const { rows: [fill] } = await pool.query(
    `insert into ops_fill(order_id, symbol, qty, px) values ($1,$2,$3,$4) returning *`,
    [ord.order_id, symbol, qty, fillPx]);

  await pool.query(`update ops_order set status='filled', updated_at=now() where order_id=$1`, [ord.order_id]);
  return NextResponse.json({ ok:true, order: ord, fill });
}
