import useSWR from 'swr';

import { IEpisodeInfo, IEpisodeListing, IPodcastEpisodesInfo } from '../types';
import { get } from './api';

export const fetchEpisodesInfo = async (feed: string) => {
  const patchRes = patchEpisodesResponse(feed);
  try {
    const res = await get<IEpisodeListing | null>(`/feed`, { url: feed });
    return patchRes(res);
  } catch (err) {
    console.error(`Api.episodes`, `Couldn't fetch episodes from feed`, err);
    throw err;
  }
};

export const useEpisodesInfo = (feed: string) => {
  const response = useSWR(feed, fetchEpisodesInfo, { suspense: true });
  return response;
};

/**
 * Add feed prop to episodes
 */
const patchEpisodesResponse = (feed: string) => (
  res: IEpisodeListing | null,
): IPodcastEpisodesInfo | null => {
  if (res) {
    const episodes: IEpisodeInfo[] = res.episodes.map((episode) => ({ ...episode, feed }));
    return { ...res, episodes, feed };
  } else {
    return null;
  }
};
