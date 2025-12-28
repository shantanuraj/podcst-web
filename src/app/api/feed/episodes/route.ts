import { type NextRequest, NextResponse } from 'next/server';
import {
  getEpisodesPaginated,
  type SortDirection,
  type SortField,
} from '@/server/ingest/podcast';

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

  const parsedPodcastId = parseInt(podcastId, 10);
  if (Number.isNaN(parsedPodcastId)) {
    return NextResponse.json(
      { message: 'parameter `podcastId` must be a number' },
      { status: 400 },
    );
  }

  const validSortFields: SortField[] = ['published', 'title', 'duration'];
  const validSortDirs: SortDirection[] = ['asc', 'desc'];

  const result = await getEpisodesPaginated({
    podcastId: parsedPodcastId,
    limit: limit ? parseInt(limit, 10) : 20,
    cursor: cursor ? parseInt(cursor, 10) : undefined,
    search: search || undefined,
    sortBy: validSortFields.includes(sortBy as SortField)
      ? (sortBy as SortField)
      : 'published',
    sortDir: validSortDirs.includes(sortDir as SortDirection)
      ? (sortDir as SortDirection)
      : 'desc',
  });

  return NextResponse.json(result);
}
