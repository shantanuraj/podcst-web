import { NextRequest, NextResponse } from 'next/server';

import { DEFAULT_PODCASTS_COUNT, MAX_PODCASTS_COUNT, MIN_PODCASTS_COUNT } from '@/data/constants';
import { top } from './top';

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;

  const limit = validLimit(params.get('limit'));
  const locale = params.get('locale') || undefined;

  const res = await top(limit, locale);
  return NextResponse.json(res);
}

function validLimit(limitStr: string | null) {
  let limit = parseInt(limitStr || '0', 10) || DEFAULT_PODCASTS_COUNT;
  limit = Math.min(limit, MAX_PODCASTS_COUNT);
  limit = Math.max(limit, MIN_PODCASTS_COUNT);
  return limit;
}
