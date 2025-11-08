import { query } from "@/core/db/pool_server";

export async function GET() {
  const { rows } = await query(`
    select symbol, count(*) as points
    from str_aux.samples_5s
    group by symbol
    order by symbol
  `);
  return new Response(JSON.stringify({ ok: true, rows }), { status: 200 });
}
