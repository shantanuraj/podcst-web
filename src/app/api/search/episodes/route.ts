import { type NextRequest, NextResponse } from 'next/server';
import { sql } from '@/server/db';
import { searchEpisodes } from '@/server/search';
import { isFeedUrlInput } from '@/shared/feed-url';

const MAX_TERM = 200;

export async function GET(request: NextRequest) {
  const term = request.nextUrl.searchParams.get('term')?.trim() ?? '';
  if (!term || term.length > MAX_TERM || isFeedUrlInput(term))
    return NextResponse.json(
      { message: 'A search term is required' },
      { status: 400 },
    );
  return NextResponse.json(await searchEpisodes(sql, term), {
    headers: { 'Cache-Control': 'public, s-maxage=300' },
  });
}
