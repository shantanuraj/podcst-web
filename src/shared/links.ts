import type { IEpisodeInfo, RenderablePodcast } from '@/types';

export function getPodcastHref(podcast: RenderablePodcast): string {
  if (podcast.id) {
    return `/episodes/${podcast.id}`;
  }
  return `/episodes/${encodeURIComponent(podcast.feed)}`;
}

export function getEpisodeHref(
  episode: IEpisodeInfo,
  podcast?: RenderablePodcast,
): string {
  const podcastId = podcast?.id ?? episode.podcastId;
  if (podcastId && episode.id) {
    return `/episodes/${podcastId}/${episode.id}`;
  }
  return `/episodes/${encodeURIComponent(episode.feed)}/${encodeURIComponent(episode.guid)}`;
}
