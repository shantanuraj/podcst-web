import {
  hashKey,
  type InfiniteData,
  infiniteQueryOptions,
} from '@tanstack/react-query';
import { type AccountScope, accountQueryKey } from '@/shared/auth/account';
import type { AccountSession } from '@/shared/auth/account-session';
import { preserveFeedContent } from '@/shared/feed-content';
import type { IPaginatedEpisodes } from '@/types';
import { get } from './api';

export type EpisodeSortField = 'published' | 'title' | 'duration';
export type EpisodeSortDir = 'asc' | 'desc';

export interface EpisodesQueryOptions {
  podcastId: string;
  search?: string;
  sortBy?: EpisodeSortField;
  sortDir?: EpisodeSortDir;
  unplayed?: boolean;
  limit?: number;
}

export const episodesQueryKey = (
  scope: AccountScope,
  podcastId: string,
  search = '',
  sortBy = 'published',
  sortDir = 'desc',
  unplayed = false,
) =>
  accountQueryKey(
    scope,
    'episodes',
    podcastId,
    search,
    sortBy,
    sortDir,
    unplayed,
  );

export function episodesQueryOptions(
  session: AccountSession,
  options: EpisodesQueryOptions,
) {
  const token = session.token();
  const queryKey = episodesQueryKey(
    token.scope,
    options.podcastId,
    options.search,
    options.sortBy,
    options.sortDir,
    options.unplayed,
  );
  return infiniteQueryOptions({
    ...session.query('episodes', options.podcastId, async (signal, cursor) => {
      const params: Record<string, string> = {
        podcastId: options.podcastId,
        limit: String(options.limit ?? 20),
      };
      if (cursor !== undefined) params.cursor = String(cursor);
      if (options.search) params.search = options.search;
      if (options.sortBy) params.sortBy = options.sortBy;
      if (options.sortDir) params.sortDir = options.sortDir;
      if (options.unplayed) params.unplayed = 'true';
      const next = await get<IPaginatedEpisodes>(
        '/feed/episodes',
        params,
        undefined,
        signal,
      );
      const previous =
        session.client.getQueryData<InfiniteData<IPaginatedEpisodes>>(queryKey);
      return preserveFeedContent(
        cursor === undefined && next.freshness?.content === 'missing'
          ? { episodes: previous?.pages.flatMap((page) => page.episodes) ?? [] }
          : previous?.pages[previous.pageParams.indexOf(cursor)],
        next,
      );
    }),
    queryKey,
    initialPageParam: undefined as number | undefined,
    getNextPageParam: (lastPage, _pages, cursor) => {
      const next = lastPage.nextCursor;
      return lastPage.hasMore &&
        next !== undefined &&
        Number.isSafeInteger(next) &&
        next > (cursor ?? 0)
        ? next
        : undefined;
    },
    refetchOnMount: (query) =>
      query.queryHash !==
      hashKey(episodesQueryKey(token.scope, options.podcastId)),
    staleTime: 5 * 60_000,
    gcTime: 30 * 60_000,
  });
}
