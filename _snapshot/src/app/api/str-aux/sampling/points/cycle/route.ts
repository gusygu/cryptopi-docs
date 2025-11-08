import { query } from "@/core/db/pool_server";

export async function POST(req: Request) {
  const { symbol, ts } = await req.json();
  await query(`select str_aux.sp_roll_cycle_40s($1, str_aux._floor_to_seconds($2, 40))`, [symbol, ts]);
  return new Response(JSON.stringify({ ok: true }), { status: 200 });
}
