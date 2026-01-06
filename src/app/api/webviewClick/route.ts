import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

const noContent = () => new NextResponse(null, { status: 204 });

export function OPTIONS() {
  return noContent();
}

export function GET() {
  return noContent();
}

export async function POST(_request: NextRequest) {
  return noContent();
}
