import { query } from "@/core/db/pool_server";

export async function POST(req: Request) {
  const { symbol, label } = await req.json();
  await query(`select str_aux.try_roll_window_now($1,$2)`, [symbol, label]);
  return new Response(JSON.stringify({ ok: true }), { status: 200 });
}

// src/app/api/sampling/window/route.ts (PUT)

export async function PUT(req: Request) {
  const { symbol, label } = await req.json();
  await query(`select str_aux.recompute_window_stats($1,$2)`, [symbol, label]);
  await query(`select str_aux.recompute_window_vectors($1,$2)`, [symbol, label]);
  return new Response(JSON.stringify({ ok: true }), { status: 200 });
}
