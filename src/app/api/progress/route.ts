import { type NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/server/auth/session';
import { privateFeedHeaders as headers } from '@/server/podcast-access';
import {
  getCurrentProgress,
  getEpisodeProgress,
  getPodcastProgress,
  getRecentProgress,
  saveProgress,
} from '@/server/progress';

const RECENT_LIMIT = 10;
const EPISODE_IDS_LIMIT = 200;

export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
  }

  const params = request.nextUrl.searchParams;
  const recent = params.get('recent');
  if (recent !== null) {
    const limit = Number(recent);
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > RECENT_LIMIT)
      return NextResponse.json(
        { message: `recent must be an integer from 1 to ${RECENT_LIMIT}` },
        { status: 400 },
      );
    return NextResponse.json(await getRecentProgress(session.userId, limit), {
      headers,
    });
  }

  const episodes = params.get('episodeIds');
  if (episodes !== null) {
    const ids = episodes.split(',').map(Number);
    if (
      !ids.length ||
      ids.length > EPISODE_IDS_LIMIT ||
      !ids.every((id) => Number.isSafeInteger(id) && id > 0)
    )
      return NextResponse.json(
        {
          message: `episodeIds must be 1 to ${EPISODE_IDS_LIMIT} positive integers`,
        },
        { status: 400 },
      );
    return NextResponse.json(await getEpisodeProgress(session.userId, ids), {
      headers,
    });
  }

  const podcast = params.get('podcastId');
  if (podcast !== null) {
    const podcastId = Number(podcast);
    if (!Number.isSafeInteger(podcastId) || podcastId <= 0)
      return NextResponse.json(
        { message: 'podcastId must be a positive integer' },
        { status: 400 },
      );
    return NextResponse.json(
      await getPodcastProgress(session.userId, podcastId),
      { headers },
    );
  }

  const progress = await getCurrentProgress(session.userId);
  return NextResponse.json(progress, { headers });
}

export async function PUT(request: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
  }

  const body = (await request.json().catch(() => null)) ?? {};
  const { episodeId, position, completed } = body;

  if (typeof episodeId !== 'number' || typeof position !== 'number') {
    return NextResponse.json(
      { message: 'episodeId and position required' },
      { status: 400 },
    );
  }

  const success = await saveProgress(
    session.userId,
    episodeId,
    Math.floor(position),
    completed === true,
  );

  if (!success) {
    return NextResponse.json({ message: 'Episode not found' }, { status: 404 });
  }

  return NextResponse.json({ success: true });
}
