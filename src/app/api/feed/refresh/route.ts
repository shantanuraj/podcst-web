import { type NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/server/auth/session';
import { sql } from '@/server/db';
import { refreshFeed } from '@/server/ingest/feed-refresh';
import { refreshPodcast } from '@/server/ingest/podcast';
import {
  canAccessPodcast,
  privateFeedHeaders as headers,
} from '@/server/podcast-access';
import { isCanonicalId } from '@/shared/canonical-id';

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const podcastId = body?.podcastId;

  if (!isCanonicalId(podcastId)) {
    return NextResponse.json(
      { message: 'podcastId must be a positive integer' },
      { status: 400 },
    );
  }

  const session = await getSession();
  const userId = session?.userId ?? null;
  if (!(await canAccessPodcast(sql, podcastId, userId))) {
    return NextResponse.json(
      { message: 'Podcast not found' },
      { status: 404, headers },
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
    return NextResponse.json({ status }, { status: code, headers });
  }

  const podcast = await refreshPodcast(podcastId, userId);

  if (!podcast) {
    return NextResponse.json(
      { message: 'Failed to refresh feed' },
      { status: 500 },
    );
  }

  return NextResponse.json(podcast, { headers });
}
