import { isCanonicalId } from '@/shared/canonical-id';
import type { IEpisodeInfo, IPodcastInfo } from '@/types';

export interface PublicEpisode {
  podcast: IPodcastInfo;
  episode: IEpisodeInfo;
}

const headers = { 'Cache-Control': 'public, max-age=60, s-maxage=300' };

export async function publicEpisodeResponse(
  episodeId: string,
  podcastId: string | null,
  load: (episodeId: string) => Promise<PublicEpisode | null>,
) {
  if (!isCanonicalId(episodeId) || !isCanonicalId(podcastId))
    return Response.json({ message: 'Invalid episode ID' }, { status: 400 });
  try {
    const found = await load(episodeId);
    return found &&
      !found.podcast.isPrivate &&
      found.podcast.id === podcastId &&
      found.episode.podcastId === podcastId
      ? Response.json(found, { headers })
      : Response.json({ message: 'Episode not found' }, { status: 404 });
  } catch {
    return Response.json({ message: 'Episode unavailable' }, { status: 503 });
  }
}
