import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { useAccountSession } from '@/shared/auth/AccountBoundary';
import { type AccountScope, accountQueryKey } from '@/shared/auth/account';
import { preserveFeedContent } from '@/shared/feed-content';
import { useSubscriptions } from '@/shared/subscriptions/useSubscriptions';
import type {
  IEpisodeListing,
  IPodcastEpisodesInfo,
  IPodcastInfo,
} from '@/types';
import { get } from './api';
import {
  type EpisodesQueryOptions,
  episodesQueryOptions,
} from './episode-query';
import { patchEpisodesResponse } from './episodes';

export const feedQueryKey = (scope: AccountScope, url: string) =>
  accountQueryKey(scope, 'feed', url);
export const podcastQueryKey = (scope: AccountScope, id: string) =>
  accountQueryKey(scope, 'podcast', id);

export const useFeed = (feedUrl: string | null) => {
  const session = useAccountSession();
  const token = session.token();
  const options = session.query(
    'feed',
    feedUrl ?? '',
    async (signal): Promise<IPodcastEpisodesInfo | null> => {
      if (!feedUrl) return null;
      const response = await get<IEpisodeListing | null>(
        '/feed',
        { url: feedUrl },
        undefined,
        signal,
      );
      const next = patchEpisodesResponse(feedUrl)(response);
      const patched = next
        ? preserveFeedContent(
            session.client.getQueryData<IPodcastEpisodesInfo>(options.queryKey),
            next,
          )
        : next;
      if (patched && session.current(token, feedUrl))
        await useSubscriptions.getState().syncSubscription(feedUrl, patched);
      return patched;
    },
  );
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

export const usePodcast = (podcastId: string) => {
  const session = useAccountSession();
  const token = session.token();
  const options = session.query(
    'podcast',
    podcastId,
    async (signal): Promise<IPodcastEpisodesInfo | null> => {
      const response = await get<IPodcastEpisodesInfo | null>(
        '/feed',
        { id: String(podcastId) },
        undefined,
        signal,
      );
      const next = response
        ? preserveFeedContent(
            session.client.getQueryData<IPodcastEpisodesInfo>(options.queryKey),
            response,
          )
        : response;
      if (next && session.current(token, podcastId))
        await useSubscriptions.getState().syncSubscription(next.feed, next);
      return next;
    },
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

export const usePodcastInfo = (podcastId: string) => {
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

export type { EpisodeSortDir, EpisodeSortField } from './episode-query';

export const useEpisodesInfinite = (options: EpisodesQueryOptions) => {
  const session = useAccountSession();
  const token = session.token();
  const query = useInfiniteQuery(episodesQueryOptions(session, options));
  return {
    ...query,
    data: session.current(token, options.podcastId) ? query.data : undefined,
  };
};
