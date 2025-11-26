import { NextRequest, NextResponse } from 'next/server';
import { getStatus, startTicker, stopTicker } from 'legacy/sampler/binanceTicker';

export const dynamic = 'force-dynamic';

type TickerPayload = Record<string, unknown>;

const toPayload = (value: unknown): TickerPayload =>
  typeof value === 'object' && value !== null ? (value as TickerPayload) : {};

export async function GET() {
  return NextResponse.json({ ok: true, status: getStatus() });
}

export async function POST(req: NextRequest) {
  try {
    const raw = await req.json().catch(() => ({}));
    const payload = toPayload(raw);
    const out = startTicker(payload);
    return NextResponse.json(out, { status: out.ok ? 200 : 409 });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'error';
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

export async function DELETE() {
  try {
    const out = stopTicker();
    return NextResponse.json(out, { status: out.ok ? 200 : 409 });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'error';
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
