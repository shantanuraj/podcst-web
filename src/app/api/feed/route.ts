import { type NextRequest, NextResponse } from 'next/server';
import { cache, isCached } from '@/app/api/redis';
import { getPodcastByFeedUrl, ingestPodcast } from '@/server/ingest/podcast';
import { patchFeedResponse } from './patch';

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const url = params.get('url');
  if (!url) {
    return NextResponse.json({ message: 'parameter `url` cannot be empty' }, { status: 400 });
  }

  const feedUrl = decodeURIComponent(url);
  try {
    new URL(feedUrl);
  } catch {
    return NextResponse.json({ message: 'parameter `url` cannot be parsed' }, { status: 400 });
  }

  const redisData = await cache.feed(feedUrl);
  if (isCached(redisData) && redisData.entity) {
    return NextResponse.json(patchFeedResponse(feedUrl, redisData.entity));
  }

  let podcast = await getPodcastByFeedUrl(feedUrl);

  if (podcast && podcast.episodes.length > 0) {
    cache.saveFeed(feedUrl, podcast);
    return NextResponse.json(podcast);
  }

  podcast = await ingestPodcast(feedUrl);

  if (podcast) {
    cache.saveFeed(feedUrl, podcast);
  }

  return NextResponse.json(podcast);
}
