import { CancelledError, hashKey, queryOptions } from '@tanstack/react-query';
import type { AccountSession } from '@/shared/auth/account-session';
import { ApiError, isAccessDenied } from './api';
import { episodesQueryKey } from './episode-query';

class FeedRefreshBusy extends Error {}

export function feedRefreshOptions(
  session: AccountSession,
  podcastId: number,
  refreshRoute: () => void,
  empty = false,
) {
  const queryClient = session.client;
  const token = session.token();
  const options = session.query('feed-refresh', podcastId, async (signal) => {
    const res = await fetch('/api/feed/refresh', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ podcastId, onlyIfStale: true }),
      signal,
    });
    if (res.status === 202) {
      throw new FeedRefreshBusy('Feed refresh in progress');
    }
    if (!res.ok) {
      throw new ApiError(res.status, 'Feed refresh unavailable');
    }
    const { status }: { status?: unknown } = await res.json();
    if (
      status !== 'updated' &&
      status !== 'not_modified' &&
      status !== 'skipped'
    ) {
      throw new Error('Invalid feed refresh status');
    }
    if (!session.current(token, podcastId) || signal.aborted)
      throw new CancelledError();
    const wasBusy =
      queryClient.getQueryState(options.queryKey)?.fetchFailureReason instanceof
      FeedRefreshBusy;
    if (status === 'updated' || empty || wasBusy) {
      const queries = {
        predicate: ({ queryKey }: { queryKey: readonly unknown[] }) =>
          queryKey[0] === 'account' &&
          queryKey[1] === token.scope &&
          ['episodes', 'podcast', 'podcast-info'].includes(
            String(queryKey[2]),
          ) &&
          queryKey[3] === podcastId,
      };
      await queryClient.cancelQueries(queries);
      await queryClient.invalidateQueries({
        ...queries,
        refetchType: 'none',
      });
      if (!session.current(token, podcastId) || signal.aborted)
        throw new CancelledError();
      refreshRoute();
      void queryClient.refetchQueries({
        type: 'active',
        predicate: (query) =>
          queries.predicate(query) &&
          query.queryHash !== hashKey(episodesQueryKey(token.scope, podcastId)),
      });
    }
    return status;
  });
  return queryOptions({
    ...options,
    staleTime: empty ? 0 : 5 * 60 * 1000,
    refetchOnWindowFocus: false,
    retry: (count, error) =>
      !isAccessDenied(error) && !(error instanceof CancelledError) && count < 6,
    retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 10_000),
  });
}
