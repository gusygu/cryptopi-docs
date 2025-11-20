import { query } from "@/core/db/pool_server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Body = {
  symbol: string;
  ts?: number;                     // ms
  density?: number | null;
  stats?: Record<string, number | null>;
  model?: Record<string, any>;     // optional raw buckets/features
};

export async function POST(req: Request) {
  const { symbol, ts, density, stats, model }: Body = await req.json();
  if (!symbol) return new Response(JSON.stringify({ ok: false, error: "symbol required" }), { status: 400 });

  const S = symbol.toUpperCase();
  const t = typeof ts === "number" ? ts : Date.now();

  // optional model
  if (model) {
    await query(
      `select str_aux.upsert_sample_5s_model($1, to_timestamp($2/1000.0), $3::jsonb)`,
      [S, t, JSON.stringify(model)]
    );
  }

  // scalar stats sample (legacy hook)
  const attrs = {
    density: density ?? null,
    stats: stats ?? {},
  };
  await query(
    `select str_aux.upsert_sample_5s(
       $1::text, to_timestamp($2/1000.0),
       $3::numeric, $4::numeric, $5::numeric, $6::numeric,
       $7::numeric, $8::numeric, $9::numeric, $10::numeric,
       $11::int, $12::int, $13::jsonb,
       $14::smallint, $15::int, $16::int, $17::int,
       $18::numeric, $19::numeric, $20::numeric,
       $21::numeric, $22::numeric,
       $23::numeric,
       $24::jsonb
     )`,
    [
      S,
      t,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      attrs,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      [],
    ]
  );

  // roll 40s cycle
  await query(
    `select str_aux.sp_roll_cycle_40s($1, str_aux._floor_to_seconds(to_timestamp($2/1000.0), 40))`,
    [S, t]
  );

  return new Response(JSON.stringify({ ok: true, symbol: S, ts: t }), { status: 200 });
}
