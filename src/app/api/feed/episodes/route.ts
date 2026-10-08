import { type NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/server/auth/session';
import { sql } from '@/server/db';
import {
  getEpisodesPaginated,
  type SortDirection,
  type SortField,
} from '@/server/ingest/podcast';
import {
  canAccessPodcast,
  privateFeedHeaders as headers,
} from '@/server/podcast-access';
import { isCanonicalId } from '@/shared/canonical-id';

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const podcastId = params.get('podcastId');
  const limit = params.get('limit');
  const cursor = params.get('cursor');
  const search = params.get('search');
  const sortBy = params.get('sortBy');
  const sortDir = params.get('sortDir');

  if (!podcastId) {
    return NextResponse.json(
      { message: 'parameter `podcastId` required' },
      { status: 400 },
    );
  }

  const parsedPodcastId = podcastId;
  if (!isCanonicalId(parsedPodcastId)) {
    return NextResponse.json(
      { message: 'parameter `podcastId` must be a number' },
      { status: 400 },
    );
  }

  const pageSize = limit === null ? 20 : Number(limit);
  const offset = cursor === null ? undefined : Number(cursor);
  if (
    (limit !== null && !/^[1-9]\d*$/.test(limit)) ||
    !Number.isSafeInteger(pageSize) ||
    pageSize < 1 ||
    pageSize > 200 ||
    (cursor !== null &&
      (!/^(0|[1-9]\d*)$/.test(cursor) ||
        !Number.isSafeInteger(offset) ||
        (offset ?? 0) > 2147483647)) ||
    (search !== null && search.length > 200)
  )
    return NextResponse.json(
      { message: 'Invalid episode page bounds' },
      { status: 400, headers },
    );

  const session = await getSession();
  const userId = session?.userId ?? null;
  if (!(await canAccessPodcast(sql, parsedPodcastId, userId))) {
    return NextResponse.json(
      { message: 'Podcast not found' },
      { status: 404, headers },
    );
  }

  const validSortFields: SortField[] = ['published', 'title', 'duration'];
  const validSortDirs: SortDirection[] = ['asc', 'desc'];

  const result = await getEpisodesPaginated(
    {
      podcastId: parsedPodcastId,
      limit: pageSize,
      cursor: offset,
      search: search || undefined,
      sortBy: validSortFields.includes(sortBy as SortField)
        ? (sortBy as SortField)
        : 'published',
      sortDir: validSortDirs.includes(sortDir as SortDirection)
        ? (sortDir as SortDirection)
        : 'desc',
      unplayedBy:
        params.get('unplayed') === 'true' && userId ? userId : undefined,
    },
    userId,
  );

  return NextResponse.json(result, { headers });
}
