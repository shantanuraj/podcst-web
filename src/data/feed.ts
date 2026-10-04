import { hashKey, useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { useAccountSession } from '@/shared/auth/AccountBoundary';
import { type AccountScope, accountQueryKey } from '@/shared/auth/account';
import { useSubscriptions } from '@/shared/subscriptions/useSubscriptions';
import type {
  IEpisodeListing,
  IPaginatedEpisodes,
  IPodcastEpisodesInfo,
  IPodcastInfo,
} from '@/types';
import { get } from './api';
import { episodesQueryKey } from './episode-query';
import { patchEpisodesResponse } from './episodes';

export const feedQueryKey = (scope: AccountScope, url: string) =>
  accountQueryKey(scope, 'feed', url);
export const podcastQueryKey = (scope: AccountScope, id: number) =>
  accountQueryKey(scope, 'podcast', id);

export const useFeed = (feedUrl: string | null) => {
  const session = useAccountSession();
  const token = session.token();
  const options = session.query('feed', feedUrl ?? '', async (signal) => {
    if (!feedUrl) return null;
    const response = await get<IEpisodeListing | null>(
      '/feed',
      { url: feedUrl },
      undefined,
      signal,
    );
    const patched = patchEpisodesResponse(feedUrl)(response);
    if (patched && session.current(token, feedUrl))
      useSubscriptions.getState().syncSubscription(feedUrl, patched);
    return patched;
  });
  const query = useQuery({
    ...options,
    enabled: !!feedUrl && options.enabled,
    staleTime: 5 * 60_000,
    gcTime: 30 * 60_000,
  });
  return {
    ...query,
    data: session.current(token, feedUrl ?? '') ? query.data : undefined,
  };
};

export const usePodcast = (podcastId: number) => {
  const session = useAccountSession();
  const token = session.token();
  const options = session.query('podcast', podcastId, async (signal) => {
    const response = await get<IPodcastEpisodesInfo | null>(
      '/feed',
      { id: String(podcastId) },
      undefined,
      signal,
    );
    if (response && session.current(token, podcastId))
      useSubscriptions.getState().syncSubscription(response.feed, response);
    return response;
  });
  const query = useQuery({
    ...options,
    enabled: !!podcastId && options.enabled,
    staleTime: 5 * 60_000,
    gcTime: 30 * 60_000,
  });
  return {
    ...query,
    data: session.current(token, podcastId) ? query.data : undefined,
  };
};

export const usePodcastInfo = (podcastId: number) => {
  const session = useAccountSession();
  const token = session.token();
  const options = session.query('podcast-info', podcastId, (signal) =>
    get<IPodcastInfo | null>(
      '/feed/info',
      { id: String(podcastId) },
      undefined,
      signal,
    ),
  );
  const query = useQuery({
    ...options,
    enabled: !!podcastId && options.enabled,
    staleTime: 5 * 60_000,
    gcTime: 30 * 60_000,
  });
  return {
    ...query,
    data: session.current(token, podcastId) ? query.data : undefined,
  };
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

const fetchEpisodesPaginated = (
  options: EpisodesQueryOptions & { cursor?: number },
  signal: AbortSignal,
) => {
  const params: Record<string, string> = {
    podcastId: String(options.podcastId),
    limit: String(options.limit || 20),
  };
  if (options.cursor !== undefined) params.cursor = String(options.cursor);
  if (options.search) params.search = options.search;
  if (options.sortBy) params.sortBy = options.sortBy;
  if (options.sortDir) params.sortDir = options.sortDir;
  return get<IPaginatedEpisodes>('/feed/episodes', params, undefined, signal);
};

export const useEpisodesInfinite = (options: EpisodesQueryOptions) => {
  const session = useAccountSession();
  const token = session.token();
  const query = useInfiniteQuery({
    ...session.query('episodes', options.podcastId, (signal, cursor) =>
      fetchEpisodesPaginated({ ...options, cursor }, signal),
    ),
    queryKey: episodesQueryKey(
      token.scope,
      options.podcastId,
      options.search,
      options.sortBy,
      options.sortDir,
    ),
    initialPageParam: undefined as number | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor,
    refetchOnMount: (query) =>
      query.queryHash !==
      hashKey(episodesQueryKey(token.scope, options.podcastId)),
    staleTime: 5 * 60_000,
    gcTime: 30 * 60_000,
  });
  return {
    ...query,
    data: session.current(token, options.podcastId) ? query.data : undefined,
  };
};
