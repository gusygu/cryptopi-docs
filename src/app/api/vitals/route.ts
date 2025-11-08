import { NextResponse } from 'next/server';
import { buildHealthSnapshot, buildStatusReport } from '@/core/api/vitals';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET() {
  const [status, health] = await Promise.all([
    Promise.resolve(buildStatusReport()),
    buildHealthSnapshot(),
  ]);

  return NextResponse.json({
    ok: health.ok,
    ts: Date.now(),
    routes: {
      status: '/api/vitals/status',
      health: '/api/vitals/health',
    },
    status,
    health: {
      ts: health.ts,
      coins: health.coins,
      counts: health.counts,
      echo: health.echo,
      ok: health.ok,
    },
  }, { headers: { 'Cache-Control': 'no-store' } });
}
