import useSWR from 'swr';
import { useSubscriptions } from '../shared/subscriptions/useSubscriptions';

import { IEpisodeInfo, IEpisodeListing, IPodcastEpisodesInfo } from '../types';
import { get } from './api';

export const fetchEpisodesInfo = async (feed: string) => {
  const patchRes = patchEpisodesResponse(feed);
  try {
    const res = await get<IEpisodeListing | null>(`/feed`, { url: feed });
    const patchedResponse = patchRes(res);
    if (patchedResponse) useSubscriptions.getState().syncSubscription(feed, patchedResponse);
    return patchedResponse;
  } catch (err) {
    console.error(`Api.episodes`, `Couldn't fetch episodes from feed`, err);
    throw err;
  }
};

export const useEpisodesInfo = (feed: string, initialData: IPodcastEpisodesInfo | null = null) => {
  const response = useSWR(feed, fetchEpisodesInfo, { suspense: true, initialData });
  return response;
};

/**
 * Add feed prop to episodes
 */
const patchEpisodesResponse =
  (feed: string) =>
  (res: IEpisodeListing | null): IPodcastEpisodesInfo | null => {
    if (res) {
      const episodes: IEpisodeInfo[] = res.episodes.map((episode) => ({
        ...episode,
        feed,
        podcastTitle: res.title,
      }));
      return { ...res, episodes, feed };
    } else {
      return null;
    }
  };
