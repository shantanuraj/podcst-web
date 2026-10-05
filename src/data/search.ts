import { useQuery } from '@tanstack/react-query';
import { useAccountSession } from '@/shared/auth/AccountBoundary';
import { isFeedUrlInput } from '@/shared/feed-url';
import type { IEpisodeInfo, IPodcastSearchResult } from '@/types';
import { get, post } from './api';

export const useSearch = (input: string) => {
  const term = input.trim();
  const session = useAccountSession();
  const token = session.token();
  const url = isFeedUrlInput(term);
  const privateQuery = session.query('search', term, (signal) =>
    post<IPodcastSearchResult[]>('/search', { term }, signal),
  );
  const query = useQuery<IPodcastSearchResult[]>({
    ...(url
      ? privateQuery
      : {
          queryKey: ['catalog-search', term],
          queryFn: ({ signal }: { signal: AbortSignal }) =>
            get<IPodcastSearchResult[]>('/search', { term }, undefined, signal),
        }),
    enabled:
      !!term && (!url || (session.scope !== null && privateQuery.enabled)),
    staleTime: 30_000,
    gcTime: url ? 0 : 5 * 60_000,
    retry: false,
  });
  return {
    ...query,
    data: !url || session.current(token, term) ? query.data : undefined,
    needsSignIn: url && session.getSnapshot().ready && session.scope === null,
  };
};

export const useEpisodeSearch = (input: string) => {
  const term = input.trim();
  return useQuery<IEpisodeInfo[]>({
    queryKey: ['episode-search', term],
    queryFn: ({ signal }) =>
      get<IEpisodeInfo[]>('/search/episodes', { term }, undefined, signal),
    enabled: !!term && term.length <= 200 && !isFeedUrlInput(term),
    staleTime: 60_000,
    retry: false,
  });
};
