import { useQuery } from '@tanstack/react-query';

import { useSubscriptions } from '@/shared/subscriptions/useSubscriptions';
import type { IEpisodeListing, IPodcastEpisodesInfo } from '@/types';
import { get } from './api';
import { patchEpisodesResponse } from './episodes';

const fetchFeed = async (feedUrl: string): Promise<IPodcastEpisodesInfo | null> => {
  const res = await get<IEpisodeListing | null>(`/feed`, { url: feedUrl });
  const patched = patchEpisodesResponse(feedUrl)(res);
  if (patched) useSubscriptions.getState().syncSubscription(feedUrl, patched);
  return patched;
};

export const useFeed = (feedUrl: string | null) => {
  return useQuery({
    queryKey: ['feed', feedUrl],
    queryFn: () => fetchFeed(feedUrl as string),
    enabled: !!feedUrl,
    staleTime: 5 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
  });
};

export const feedQueryKey = (feedUrl: string) => ['feed', feedUrl];
