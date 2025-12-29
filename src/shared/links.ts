import type { IEpisodeInfo, RenderablePodcast } from '@/types';

export function getPodcastHref(
  podcast: Pick<RenderablePodcast, 'id' | 'feed'>,
): string {
  if (podcast.id) {
    return `/episodes/${podcast.id}`;
  }
  return `/episodes/${encodeURIComponent(podcast.feed)}`;
}

export function getEpisodeHref(
  episode: IEpisodeInfo,
  podcastId?: number,
): string {
  const episodePodcastId = podcastId ?? episode.podcastId;
  if (episodePodcastId && episode.id) {
    return `/episodes/${episodePodcastId}/${episode.id}`;
  }
  return `/episodes/${encodeURIComponent(episode.feed)}/${encodeURIComponent(episode.guid)}`;
}
