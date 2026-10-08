import type {
  IEpisodeInfo,
  IPodcastSearchResult,
  RenderablePodcast,
} from '@/types';

export function getSearchResultHref(result: IPodcastSearchResult): string {
  if (result.id) return getPodcastHref(result);
  if (result.itunes_id) return `/itunes/${result.itunes_id}`;
  return getPodcastHref(result);
}

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
  podcastId?: string,
): string {
  const episodePodcastId = podcastId ?? episode.podcastId;
  if (episodePodcastId && episode.id) {
    return `/episodes/${episodePodcastId}/${episode.id}`;
  }
  return `/episodes/${encodeURIComponent(episode.feed)}/${encodeURIComponent(episode.guid)}`;
}
