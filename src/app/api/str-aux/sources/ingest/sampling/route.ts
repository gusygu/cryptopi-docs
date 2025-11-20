import { query } from "@/core/db/pool_server";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const symbolFilter = (url.searchParams.get("symbol") ?? "").trim().toUpperCase();
  const limit = Math.min(
    500,
    Math.max(1, Number(url.searchParams.get("limit") ?? "50"))
  );
  const latestOnly = (url.searchParams.get("latest") ?? "").toLowerCase() === "true";

  if (!symbolFilter && !latestOnly) {
    const { rows } = await query(`
      select symbol, count(*) as points
        from str_aux.samples_5s
       group by symbol
       order by symbol
    `);
    return new Response(JSON.stringify({ ok: true, rows }), { status: 200 });
  }

  const params = symbolFilter ? [symbolFilter, limit] : [null, limit];
  try {
    const { rows } = await query(
      `
      select s.symbol,
             s.ts,
             s.v_inner,
             s.v_outer,
             s.v_swap,
             s.v_tendency,
             s.disruption,
             s.amp,
             s.volt,
             s.inertia,
             s.mode_general,
             s.mode_b,
             s.attrs,
             s.bucket_count,
             s.tick_ms_min,
             s.tick_ms_max,
             s.tick_ms_avg,
             s.spread_min,
             s.spread_max,
             s.spread_avg,
             s.mid_min,
             s.mid_max,
             s.liquidity_imbalance,
             s.quality_flags,
             m.density,
             m.stats as model_stats
        from str_aux.samples_5s s
        left join str_aux.samples_5s_model m
          on s.symbol = m.symbol
         and s.ts = m.ts
       where ($1::text is null or s.symbol = $1)
       order by s.ts desc
       limit $2
    `,
      params,
    );
    return new Response(JSON.stringify({ ok: true, rows }), { status: 200 });
  } catch (err: any) {
    if (err?.code !== "42703") {
      throw err;
    }
    const { rows } = await query(
      `
      select s.symbol,
             s.ts,
             s.v_inner,
             s.v_outer,
             s.v_swap,
             s.v_tendency,
             s.disruption,
             s.amp,
             s.volt,
             s.inertia,
             s.mode_general,
             s.mode_b,
             s.attrs,
             m.density,
             m.stats as model_stats
        from str_aux.samples_5s s
        left join str_aux.samples_5s_model m
          on s.symbol = m.symbol
         and s.ts = m.ts
       where ($1::text is null or s.symbol = $1)
       order by s.ts desc
       limit $2
    `,
      params,
    );
    const shaped = rows.map((row) => ({
      ...row,
      bucket_count: null,
      tick_ms_min: null,
      tick_ms_max: null,
      tick_ms_avg: null,
      spread_min: null,
      spread_max: null,
      spread_avg: null,
      mid_min: null,
      mid_max: null,
      liquidity_imbalance: null,
      quality_flags: [],
    }));
    return new Response(JSON.stringify({ ok: true, rows: shaped }), { status: 200 });
  }
}
