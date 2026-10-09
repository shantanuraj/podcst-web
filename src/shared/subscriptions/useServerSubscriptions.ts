import { useMutation, useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { get } from '@/data/api';
import { stateRuntime, useDurableState } from '@/data/state-browser';
import { useAccountSession } from '@/shared/auth/AccountBoundary';
import { accountQueryKey } from '@/shared/auth/account';
import { preserveFeedContent } from '@/shared/feed-content';
import { feedRecheckDelay } from '@/shared/feed-contract';
import type { IPodcastEpisodesInfo } from '@/types';

export function useServerSubscriptions() {
  const session = useAccountSession();
  const token = session.token();
  const durable = useDurableState();
  const startedAt = useMemo(() => Date.now(), [token]);
  const options = session.query(
    'subscriptions',
    'library',
    async (signal): Promise<IPodcastEpisodesInfo[]> => {
      const next = await get<IPodcastEpisodesInfo[]>(
        '/subscriptions',
        {},
        undefined,
        signal,
      );
      const previous = session.client.getQueryData<IPodcastEpisodesInfo[]>(
        accountQueryKey(token.scope, 'subscriptions', 'library'),
      );
      return next.map((podcast) =>
        preserveFeedContent(
          previous?.find((item) => item.id === podcast.id),
          podcast,
        ),
      );
    },
  );
  const query = useQuery({
    ...options,
    enabled: options.enabled && token.scope !== null,
    refetchInterval: (query) => {
      if (
        typeof document !== 'undefined' &&
        document.visibilityState === 'hidden'
      )
        return false;
      const delays =
        query.state.data?.flatMap((podcast) => {
          const delay = feedRecheckDelay(podcast.freshness, startedAt);
          return delay === false ? [] : [delay];
        }) ?? [];
      return delays.length ? Math.min(...delays) : false;
    },
  });
  return {
    ...query,
    initialized: durable.followsInitialized,
    membership: durable.follows,
    syncError: durable.error,
    pending: durable.followsPending,
    data: session.current(token, 'library')
      ? query.data?.filter(
          (podcast) =>
            podcast.id && durable.follows.get(podcast.id) === 'available',
        )
      : undefined,
  };
}
function useFollowChange(followed: boolean) {
  const session = useAccountSession();
  const token = session.token();
  const durable = useDurableState();
  const mutation = useMutation({
    mutationKey: accountQueryKey(
      token.scope,
      followed ? 'subscribe' : 'unsubscribe',
    ),
    mutationFn: async (podcastId: string) => {
      if (!session.current(token)) throw new Error('Session changed');
      await stateRuntime(session).sync.follow(podcastId, followed);
      return token;
    },
  });
  return {
    ...mutation,
    unavailablePodcastId:
      followed &&
      mutation.isSuccess &&
      session.current(mutation.data) &&
      durable.failedFollows.includes(mutation.variables) &&
      !durable.follows.has(mutation.variables)
        ? mutation.variables
        : undefined,
  };
}
export const useSubscribe = () => useFollowChange(true);
export const useUnsubscribe = () => useFollowChange(false);
export function useSyncToCloud() {
  const session = useAccountSession();
  const token = session.token();
  return useMutation({
    mutationKey: accountQueryKey(token.scope, 'sync-subscriptions'),
    mutationFn: (feedUrls: string[]) => {
      if (!session.current(token)) throw new Error('Session changed');
      return stateRuntime(session).sync.resolveFeeds(feedUrls);
    },
  });
}
