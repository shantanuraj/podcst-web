import { hashKey, type QueryClient, queryOptions } from '@tanstack/react-query';
import { episodesQueryKey } from './episode-query';

class FeedRefreshBusy extends Error {}

export function feedRefreshOptions(
  queryClient: QueryClient,
  podcastId: number,
  refreshRoute: () => void,
  empty = false,
) {
  const queryKey = ['feed-refresh', podcastId];
  return queryOptions({
    queryKey,
    queryFn: async ({ signal }) => {
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
        throw new Error('Feed refresh unavailable');
      }
      const { status }: { status?: unknown } = await res.json();
      if (
        status !== 'updated' &&
        status !== 'not_modified' &&
        status !== 'skipped'
      ) {
        throw new Error('Invalid feed refresh status');
      }
      const wasBusy =
        queryClient.getQueryState(queryKey)?.fetchFailureReason instanceof
        FeedRefreshBusy;
      if (status === 'updated' || empty || wasBusy) {
        const queries = {
          predicate: ({ queryKey }: { queryKey: readonly unknown[] }) =>
            ['episodes', 'podcast', 'podcast-info'].includes(
              String(queryKey[0]),
            ) && queryKey[1] === podcastId,
        };
        await queryClient.cancelQueries(queries);
        await queryClient.invalidateQueries({
          ...queries,
          refetchType: 'none',
        });
        if (!signal.aborted) refreshRoute();
        void queryClient.refetchQueries({
          type: 'active',
          predicate: (query) =>
            queries.predicate(query) &&
            query.queryHash !== hashKey(episodesQueryKey(podcastId)),
        });
      }
      return status;
    },
    staleTime: empty ? 0 : 5 * 60 * 1000,
    refetchOnWindowFocus: false,
    retry: 6,
    retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 10_000),
  });
}
