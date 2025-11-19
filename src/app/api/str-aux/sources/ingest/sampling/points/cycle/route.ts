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

  // scalar stats sample
  await query(
    `select str_aux.upsert_sample_5s($1, to_timestamp($2/1000.0), $3, $4::jsonb)`,
    [S, t, density ?? null, JSON.stringify(stats ?? {})]
  );

  // roll 40s cycle
  await query(
    `select str_aux.sp_roll_cycle_40s($1, str_aux._floor_to_seconds(to_timestamp($2/1000.0), 40))`,
    [S, t]
  );

  return new Response(JSON.stringify({ ok: true, symbol: S, ts: t }), { status: 200 });
}
