import { type NextRequest, NextResponse } from 'next/server';
import { DEFAULT_PODCASTS_LOCALE } from '@/data/constants';
import { sql } from '@/server/db';
import { related } from '@/server/discover';
import { podcastAccess } from '@/server/podcast-access';

const LIMIT = 4;

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const id = Number(params.get('id'));
  if (!Number.isSafeInteger(id) || id <= 0)
    return NextResponse.json(
      { message: 'parameter `id` must be a positive integer' },
      { status: 400 },
    );
  const [visible] =
    await sql`SELECT 1 FROM podcasts p WHERE p.id = ${id} AND ${podcastAccess(sql, null)}`;
  if (!visible)
    return NextResponse.json({ message: 'Podcast not found' }, { status: 404 });
  return NextResponse.json(
    await related(id, params.get('locale') || DEFAULT_PODCASTS_LOCALE, LIMIT),
  );
}
