import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

const getIpFromHeaders = (request: NextRequest): string | null => {
  const forwardedFor = request.headers.get('x-forwarded-for');
  if (forwardedFor) {
    const first = forwardedFor.split(',')[0]?.trim();
    if (first) return first;
  }

  const realIp = request.headers.get('x-real-ip')?.trim();
  if (realIp) return realIp;

  return null;
};

export function GET(request: NextRequest) {
  const ip = getIpFromHeaders(request);
  return NextResponse.json({ ip });
}

