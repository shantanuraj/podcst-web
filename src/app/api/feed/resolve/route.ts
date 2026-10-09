import { type NextRequest, NextResponse } from 'next/server';
import { DEFAULT_PODCASTS_LOCALE } from '@/data/constants';
import { sql } from '@/server/db';
import { resolveInteractivePodcast } from '@/server/ingest/interactive-admission';
import { feedError, readFeedBody } from '@/server/ingest/interactive-response';
import { privateFeedHeaders as headers } from '@/server/podcast-access';
import { isCanonicalId } from '@/shared/canonical-id';

export async function POST(request: NextRequest) {
  try {
    const body = await readFeedBody(request);
    const itunesId = body.itunes_id;
    const locale = body.locale ?? DEFAULT_PODCASTS_LOCALE;
    if (
      !isCanonicalId(itunesId) ||
      typeof locale !== 'string' ||
      !/^[a-z]{2}$/i.test(locale)
    )
      throw new TypeError();
    const id = await resolveInteractivePodcast(
      sql,
      itunesId,
      locale.toLowerCase(),
      request.headers,
      request.signal,
    );
    return id === null
      ? NextResponse.json(
          { message: 'Podcast not found' },
          { status: 404, headers },
        )
      : NextResponse.json({ id }, { headers });
  } catch (error) {
    return feedError(error);
  }
}
