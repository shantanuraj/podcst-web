import { type NextRequest, NextResponse } from 'next/server';
import { sql } from '@/server/db';
import { refreshFeed } from '@/server/ingest/feed-refresh';
import { refreshPodcast } from '@/server/ingest/podcast';

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const podcastId = body?.podcastId;

  if (!Number.isSafeInteger(podcastId) || podcastId <= 0) {
    return NextResponse.json(
      { message: 'podcastId must be a positive integer' },
      { status: 400 },
    );
  }

  if (body.onlyIfStale === true) {
    const status = await refreshFeed(sql, podcastId);
    const code =
      status === 'not_found'
        ? 404
        : status === 'error'
          ? 502
          : status === 'busy'
            ? 202
            : 200;
    return NextResponse.json({ status }, { status: code });
  }

  const podcast = await refreshPodcast(podcastId);

  if (!podcast) {
    return NextResponse.json(
      { message: 'Failed to refresh feed' },
      { status: 500 },
    );
  }

  return NextResponse.json(podcast);
}
