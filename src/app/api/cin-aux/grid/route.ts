// app/api/cin-aux/grid/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { pool } from '@/core/db';

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const session_id = url.searchParams.get('session_id');
  const cycle_id = url.searchParams.get('cycle_id');
  if (!session_id || !cycle_id) return NextResponse.json({error:'session_id & cycle_id required'},{status:400});

  const { rows } = await pool.query(
    `select symbol, profit, imprint, luggage
     from cin_grid_view where session_id=$1 and cycle_id=$2
     order by symbol`, [session_id, cycle_id]);

  return NextResponse.json({ ok:true, session_id, cycle_id, grid: rows });
}
