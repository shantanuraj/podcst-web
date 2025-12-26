import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { IPodcastEpisodesInfo } from '@/types';

const SUBSCRIPTIONS_KEY = ['subscriptions'];

export function useServerSubscriptions() {
  return useQuery({
    queryKey: SUBSCRIPTIONS_KEY,
    queryFn: async (): Promise<IPodcastEpisodesInfo[]> => {
      const res = await fetch('/api/subscriptions');
      if (!res.ok) return [];
      return res.json();
    },
  });
}

export function useSubscribe() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (podcastId: number) => {
      const res = await fetch('/api/subscriptions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ podcastId }),
      });
      if (!res.ok) throw new Error('Failed to subscribe');
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: SUBSCRIPTIONS_KEY });
    },
  });
}

export function useUnsubscribe() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (podcastId: number) => {
      const res = await fetch(`/api/subscriptions?podcastId=${podcastId}`, {
        method: 'DELETE',
      });
      if (!res.ok) throw new Error('Failed to unsubscribe');
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: SUBSCRIPTIONS_KEY });
    },
  });
}

export function useSyncToCloud() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (
      feedUrls: string[],
    ): Promise<{ succeeded: number; failed: number }> => {
      const res = await fetch('/api/subscriptions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ feedUrls }),
      });
      if (!res.ok) throw new Error('Failed to sync');
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: SUBSCRIPTIONS_KEY });
    },
  });
}
