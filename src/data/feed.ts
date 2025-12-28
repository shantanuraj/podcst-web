import { useInfiniteQuery, useQuery } from '@tanstack/react-query';

import { useSubscriptions } from '@/shared/subscriptions/useSubscriptions';
import type {
  IEpisodeListing,
  IPaginatedEpisodes,
  IPodcastEpisodesInfo,
  IPodcastInfo,
} from '@/types';
import { get } from './api';
import { patchEpisodesResponse } from './episodes';

const fetchFeed = async (
  feedUrl: string,
): Promise<IPodcastEpisodesInfo | null> => {
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

const fetchPodcast = async (
  podcastId: number,
): Promise<IPodcastEpisodesInfo | null> => {
  const res = await get<IPodcastEpisodesInfo | null>(`/feed`, {
    id: String(podcastId),
  });
  if (res) useSubscriptions.getState().syncSubscription(res.feed, res);
  return res;
};

export const usePodcast = (
  podcastId: number,
  initialData?: IPodcastEpisodesInfo | null,
) => {
  return useQuery({
    queryKey: ['podcast', podcastId],
    queryFn: () => fetchPodcast(podcastId),
    enabled: !!podcastId,
    initialData: initialData ?? undefined,
    staleTime: 5 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
  });
};

export const podcastQueryKey = (podcastId: number) => ['podcast', podcastId];

// --- New hooks for optimized paginated loading ---

const fetchPodcastInfo = async (
  podcastId: number,
): Promise<IPodcastInfo | null> => {
  const res = await get<IPodcastInfo | null>(`/feed/info`, {
    id: String(podcastId),
  });
  return res;
};

export const usePodcastInfo = (
  podcastId: number,
  initialData?: IPodcastInfo | null,
) => {
  return useQuery({
    queryKey: ['podcast-info', podcastId],
    queryFn: () => fetchPodcastInfo(podcastId),
    enabled: !!podcastId,
    initialData: initialData ?? undefined,
    staleTime: 5 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
  });
};

export type EpisodeSortField = 'published' | 'title' | 'duration';
export type EpisodeSortDir = 'asc' | 'desc';

interface EpisodesQueryOptions {
  podcastId: number;
  search?: string;
  sortBy?: EpisodeSortField;
  sortDir?: EpisodeSortDir;
  limit?: number;
}

const fetchEpisodesPaginated = async (
  options: EpisodesQueryOptions & { cursor?: number },
): Promise<IPaginatedEpisodes> => {
  const params: Record<string, string> = {
    podcastId: String(options.podcastId),
    limit: String(options.limit || 20),
  };

  if (options.cursor !== undefined) {
    params.cursor = String(options.cursor);
  }
  if (options.search) {
    params.search = options.search;
  }
  if (options.sortBy) {
    params.sortBy = options.sortBy;
  }
  if (options.sortDir) {
    params.sortDir = options.sortDir;
  }

  const res = await get<IPaginatedEpisodes>(`/feed/episodes`, params);
  return res;
};

export const useEpisodesInfinite = (
  options: EpisodesQueryOptions,
  initialData?: IPaginatedEpisodes,
) => {
  return useInfiniteQuery({
    queryKey: [
      'episodes',
      options.podcastId,
      options.search || '',
      options.sortBy || 'published',
      options.sortDir || 'desc',
    ],
    queryFn: ({ pageParam }) =>
      fetchEpisodesPaginated({ ...options, cursor: pageParam }),
    initialPageParam: undefined as number | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor,
    initialData: initialData
      ? { pages: [initialData], pageParams: [undefined] }
      : undefined,
    staleTime: 5 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
  });
};

export const episodesQueryKey = (
  podcastId: number,
  search = '',
  sortBy = 'published',
  sortDir = 'desc',
) => ['episodes', podcastId, search, sortBy, sortDir];
