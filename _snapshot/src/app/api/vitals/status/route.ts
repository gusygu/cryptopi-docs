import { NextResponse } from 'next/server';
import { buildStatusReport } from '@/core/api/vitals';

export async function GET() {
  return NextResponse.json(buildStatusReport());
}
