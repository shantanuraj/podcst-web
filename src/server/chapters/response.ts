import { privateFeedHeaders as headers } from '@/server/podcast-access';
import { isCanonicalId } from '@/shared/canonical-id';
import type { EpisodeChapters } from '@/shared/chapters';

export async function chapterResponse(
  episodeId: string,
  userId: string | null,
  load: (id: string, userId: string | null) => Promise<EpisodeChapters | null>,
) {
  if (!isCanonicalId(episodeId))
    return Response.json(
      { message: 'Invalid episode ID' },
      { status: 400, headers },
    );
  try {
    const data = await load(episodeId, userId);
    return data
      ? Response.json(data, { headers })
      : Response.json(
          { message: 'Episode not found' },
          { status: 404, headers },
        );
  } catch {
    return Response.json(
      { message: 'Chapters unavailable' },
      { status: 503, headers },
    );
  }
}
