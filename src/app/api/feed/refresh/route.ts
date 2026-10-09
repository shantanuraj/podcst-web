import { type NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/server/auth/session';
import { sql } from '@/server/db';
import { requestFeedRefresh } from '@/server/ingest/feed-demand';
import {
  feedPrincipal,
  interactiveAdmission,
} from '@/server/ingest/interactive-admission';
import { feedError, readFeedBody } from '@/server/ingest/interactive-response';
import { privateFeedHeaders as headers } from '@/server/podcast-access';
import { feedValidator } from '@/shared/feed-contract';

export async function POST(request: NextRequest) {
  try {
    const body = await readFeedBody(request);
    if (!feedValidator('refreshRequest')(body)) throw new TypeError();
    const userId = (await getSession())?.userId ?? null;
    const principal = userId
      ? { kind: 'account' as const, id: userId }
      : feedPrincipal(request.headers);
    const freshness = await requestFeedRefresh(
      sql,
      body.podcastId,
      userId,
      async () => {
        await (await interactiveAdmission()).refresh(principal);
      },
    );
    if (!freshness)
      return NextResponse.json(
        { message: 'Podcast not found' },
        { status: 404, headers },
      );
    return NextResponse.json(
      { podcastId: body.podcastId, freshness },
      { status: freshness.state === 'pending' ? 202 : 200, headers },
    );
  } catch (error) {
    return feedError(error);
  }
}
