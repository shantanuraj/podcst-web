import { useMutation, useQuery } from '@tanstack/react-query';
import { get } from '@/data/api';
import { stateRuntime, useDurableState } from '@/data/state-browser';
import { useAccountSession } from '@/shared/auth/AccountBoundary';
import { accountQueryKey } from '@/shared/auth/account';
import type { IPodcastEpisodesInfo } from '@/types';

export function useServerSubscriptions() {
  const session = useAccountSession();
  const token = session.token();
  const durable = useDurableState();
  const options = session.query('subscriptions', 'library', (signal) =>
    get<IPodcastEpisodesInfo[]>('/subscriptions', {}, undefined, signal),
  );
  const query = useQuery({
    ...options,
    enabled: options.enabled && token.scope !== null,
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
  return useMutation({
    mutationKey: accountQueryKey(
      token.scope,
      followed ? 'subscribe' : 'unsubscribe',
    ),
    mutationFn: (podcastId: string) => {
      if (!session.current(token)) throw new Error('Session changed');
      return stateRuntime(session).sync.follow(podcastId, followed);
    },
  });
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
