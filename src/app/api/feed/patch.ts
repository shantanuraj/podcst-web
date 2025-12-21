import type { IEpisodeListing, IPodcastEpisodesInfo, IEpisodeInfo } from '@/types';

export function patchFeedResponse(feedUrl: string, data: IEpisodeListing): IPodcastEpisodesInfo {
  const episodes: IEpisodeInfo[] = data.episodes.map((episode) => ({
    ...episode,
    feed: feedUrl,
    podcastTitle: data.title,
  }));

  return { ...data, episodes, feed: feedUrl };
}
