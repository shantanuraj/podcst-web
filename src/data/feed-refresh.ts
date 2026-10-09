import { CancelledError, queryOptions } from '@tanstack/react-query';
import type { AccountSession } from '@/shared/auth/account-session';
import {
  type FeedRefreshResponse,
  feedRecheckDelay,
  feedValidator,
  requireFreshness,
} from '@/shared/feed-contract';
import type { IPaginatedEpisodes } from '@/types';
import { get, post } from './api';

type RefreshProgress = FeedRefreshResponse & { startedAt: number };

export function feedRefreshOptions(
  session: AccountSession,
  podcastId: string,
  refreshRoute: () => void,
  empty = false,
  attempt = 0,
) {
  const token = session.token();
  const queryKey = [
    'account',
    token.scope,
    'feed-refresh',
    podcastId,
    attempt,
  ] as const;
  const options = session.query(
    'feed-refresh',
    podcastId,
    async (signal): Promise<RefreshProgress> => {
      const previous = session.client.getQueryData<RefreshProgress>(queryKey);
      const startedAt = previous?.startedAt ?? Date.now();
      const result = previous
        ? {
            podcastId,
            freshness: requireFreshness(
              await get<IPaginatedEpisodes>(
                '/feed/episodes',
                { podcastId, limit: 1 },
                undefined,
                signal,
              ),
            ).freshness,
          }
        : await post<FeedRefreshResponse>(
            '/feed/refresh',
            { podcastId },
            signal,
          );
      if (
        !feedValidator('refreshResponse')(result) ||
        result.podcastId !== podcastId
      )
        throw new TypeError('Invalid refresh response');
      if (!session.current(token, podcastId) || signal.aborted)
        throw new CancelledError();
      if (
        (previous &&
          (previous.freshness.checkedAtMs !== result.freshness.checkedAtMs ||
            previous.freshness.content !== result.freshness.content)) ||
        (!previous && empty && result.freshness.content === 'cached')
      ) {
        await session.client.invalidateQueries({
          predicate: ({ queryKey: key }) =>
            key[0] === 'account' &&
            key[1] === token.scope &&
            ['episodes', 'podcast', 'podcast-info', 'subscriptions'].includes(
              String(key[2]),
            ) &&
            (key[3] === podcastId || key[2] === 'subscriptions'),
          refetchType: 'active',
        });
        if (!session.current(token, podcastId) || signal.aborted)
          throw new CancelledError();
        refreshRoute();
      }
      return { ...result, startedAt };
    },
  );
  return queryOptions({
    ...options,
    queryKey,
    staleTime: Infinity,
    gcTime: 120_000,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    retry: false,
    refetchInterval: (query) =>
      typeof document !== 'undefined' && document.visibilityState === 'hidden'
        ? false
        : feedRecheckDelay(
            query.state.data?.freshness,
            query.state.data?.startedAt ?? Date.now(),
          ),
  });
}
