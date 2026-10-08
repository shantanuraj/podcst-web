import type { NextRequest } from 'next/server';
import { getEpisodeWithPodcast } from '@/server/ingest/podcast';
import { publicEpisodeResponse } from '@/server/sharing/public-episode';

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ episodeId: string }> },
) {
  const { episodeId } = await context.params;
  return publicEpisodeResponse(
    episodeId,
    request.nextUrl.searchParams.get('podcastId'),
    (id) => getEpisodeWithPodcast(id, null),
  );
}
