import { type NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/server/auth/session';
import { PodcastIdentityConflict } from '@/server/ingest/index-podcast';
import { privateFeedHeaders as headers } from '@/server/podcast-access';
import { isFeedUrlInput } from '@/shared/feed-url';
import { search } from './search';

export async function GET(request: NextRequest) {
  const term = request.nextUrl.searchParams.get('term')?.trim();
  const locale = request.nextUrl.searchParams.get('locale') || undefined;
  if (!term || term.length > 4096) {
    return NextResponse.json(
      { message: 'A search term is required' },
      { status: 400 },
    );
  }
  if (isFeedUrlInput(term)) {
    return NextResponse.json(
      { message: 'Use authenticated POST for RSS links' },
      { status: 400, headers },
    );
  }
  return NextResponse.json(await search(term, locale));
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const term = typeof body?.term === 'string' ? body.term.trim() : '';
  const locale = typeof body?.locale === 'string' ? body.locale : undefined;
  if (!term || term.length > 4096) {
    return NextResponse.json(
      { message: 'A search term is required' },
      { status: 400, headers },
    );
  }
  const session = await getSession();
  if (isFeedUrlInput(term) && !session) {
    return NextResponse.json(
      { message: 'Sign in to open an RSS link' },
      { status: 401, headers },
    );
  }
  try {
    return NextResponse.json(
      await search(term, locale, session?.userId ?? null),
      { headers },
    );
  } catch (error) {
    const status =
      error instanceof TypeError
        ? 400
        : error instanceof PodcastIdentityConflict
          ? 409
          : 404;
    return NextResponse.json(
      { message: 'Feed unavailable' },
      { status, headers },
    );
  }
}
