import { type NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/server/auth/session';
import {
  getPodcastByFeedUrl,
  getPodcastById,
  ingestPodcast,
} from '@/server/ingest/podcast';
import { privateFeedHeaders as headers } from '@/server/podcast-access';
import { feedUrl } from '@/shared/feed-url';

export async function GET(request: NextRequest) {
  const id = request.nextUrl.searchParams.get('id');
  const url = request.nextUrl.searchParams.get('url');
  if (id) {
    const podcastId = Number(id);
    if (!Number.isSafeInteger(podcastId) || podcastId <= 0) {
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
}

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json(
      { message: 'Sign in to open an RSS link' },
      { status: 401, headers },
    );
  }
  const body = await request.json().catch(() => null);
  if (typeof body?.url !== 'string' || body.url.length > 4096) {
    return NextResponse.json(
      { message: 'A feed URL is required' },
      { status: 400, headers },
    );
  }
  try {
    const podcast = await ingestPodcast(feedUrl(body.url), session.userId);
    return podcast
      ? NextResponse.json(podcast, { headers })
      : NextResponse.json(
          { message: 'Feed unavailable' },
          { status: 404, headers },
        );
  } catch {
    return NextResponse.json(
      { message: 'Feed unavailable' },
      { status: 404, headers },
    );
  }
}
