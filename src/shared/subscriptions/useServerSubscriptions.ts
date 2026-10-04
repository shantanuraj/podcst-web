import { useMutation, useQuery } from '@tanstack/react-query';
import { get, post, responseData } from '@/data/api';
import { useAccountSession } from '@/shared/auth/AccountBoundary';
import { accountQueryKey } from '@/shared/auth/account';
import type { IPodcastEpisodesInfo } from '@/types';

export function useServerSubscriptions() {
  const session = useAccountSession();
  const token = session.token();
  const options = session.query('subscriptions', 'library', (signal) =>
    get<IPodcastEpisodesInfo[]>('/subscriptions', {}, undefined, signal),
  );
  const query = useQuery({
    ...options,
    enabled: options.enabled && token.scope !== null,
  });
  return {
    ...query,
    data: session.current(token, 'library') ? query.data : undefined,
  };
}

export function useSubscribe() {
  const session = useAccountSession();
  const token = session.token();
  return useMutation({
    mutationKey: accountQueryKey(token.scope, 'subscribe'),
    mutationFn: (podcastId: number) =>
      session.run(token, podcastId, (signal) =>
        post('/subscriptions', { podcastId }, signal),
      ),
    onSuccess: () => {
      if (session.current(token))
        void session.client.invalidateQueries({
          queryKey: accountQueryKey(token.scope, 'subscriptions'),
        });
    },
  });
}

export function useUnsubscribe() {
  const session = useAccountSession();
  const token = session.token();
  return useMutation({
    mutationKey: accountQueryKey(token.scope, 'unsubscribe'),
    mutationFn: (podcastId: number) =>
      session.run(token, podcastId, async (signal) =>
        responseData(
          await fetch(`/api/subscriptions?podcastId=${podcastId}`, {
            method: 'DELETE',
            signal,
          }),
        ),
      ),
    onSuccess: () => {
      if (session.current(token))
        void session.client.invalidateQueries({
          queryKey: accountQueryKey(token.scope, 'subscriptions'),
        });
    },
  });
}

export function useSyncToCloud() {
  const session = useAccountSession();
  const token = session.token();
  return useMutation({
    mutationKey: accountQueryKey(token.scope, 'sync-subscriptions'),
    mutationFn: (feedUrls: string[]) =>
      session.run(token, 'library', (signal) =>
        post<{ succeeded: number; failed: number }>(
          '/subscriptions',
          { feedUrls },
          signal,
        ),
      ),
    onSuccess: () => {
      if (session.current(token))
        void session.client.invalidateQueries({
          queryKey: accountQueryKey(token.scope, 'subscriptions'),
        });
    },
  });
}
