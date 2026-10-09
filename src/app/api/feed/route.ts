import { type NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/server/auth/session';
import { sql } from '@/server/db';
import { importPrivateFeed } from '@/server/ingest/interactive-admission';
import { feedError, readFeedBody } from '@/server/ingest/interactive-response';
import { getPodcastByFeedUrl, getPodcastById } from '@/server/ingest/podcast';
import { privateFeedHeaders as headers } from '@/server/podcast-access';
import { isCanonicalId } from '@/shared/canonical-id';
import { feedUrl } from '@/shared/feed-url';

export async function GET(request: NextRequest) {
  try {
    const id = request.nextUrl.searchParams.get('id');
    const url = request.nextUrl.searchParams.get('url');
    if (id) {
      const podcastId = id;
      if (!isCanonicalId(podcastId)) {
        return NextResponse.json(
          { message: 'A valid podcast ID is required' },
          { status: 400, headers },
        );
      }
      const session = await getSession();
      const podcast = await getPodcastById(podcastId, session?.userId ?? null);
      return podcast
        ? NextResponse.json(podcast, { headers })
        : NextResponse.json(
            { message: 'Podcast not found' },
            { status: 404, headers },
          );
    }
    if (url) {
      if (url.length > 4096) throw new TypeError();
      const podcast = await getPodcastByFeedUrl(url);
      return podcast
        ? NextResponse.json(podcast, { headers })
        : NextResponse.json(
            { message: 'Podcast not found' },
            { status: 404, headers },
          );
    }
    return NextResponse.json(
      { message: 'A podcast ID is required' },
      { status: 400, headers },
    );
  } catch (error) {
    return feedError(error);
  }
}

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json(
      { message: 'Sign in to open an RSS link' },
      { status: 401, headers },
    );
  }
  try {
    const body = await readFeedBody(request);
    if (typeof body?.url !== 'string' || body.url.length > 4096) {
      return NextResponse.json(
        { message: 'A feed URL is required' },
        { status: 400, headers },
      );
    }
    const id = await importPrivateFeed(
      sql,
      feedUrl(body.url),
      session,
      request.signal,
    );
    const podcast = await getPodcastById(id, session.userId);
    return podcast
      ? NextResponse.json(podcast, { headers })
      : NextResponse.json(
          { message: 'Feed unavailable' },
          { status: 404, headers },
        );
  } catch (error) {
    return feedError(error);
  }
}
