'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { useTranslation } from '@/shared/i18n';

interface Props {
  podcastId: number;
  empty?: boolean;
}

export function FeedRefresh({ podcastId, empty = false }: Props) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { t } = useTranslation();
  const { dataUpdatedAt, isPending } = useQuery({
    queryKey: ['feed-refresh', podcastId],
    queryFn: async () => {
      const res = await fetch('/api/feed/refresh', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ podcastId, onlyIfStale: true }),
      });
      if (!res.ok || res.status === 202) {
        throw new Error('Feed refresh unavailable');
      }
      return true;
    },
    staleTime: 0,
    refetchOnWindowFocus: false,
    retry: 6,
    retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 10_000),
  });

  useEffect(() => {
    if (!dataUpdatedAt) return;
    void queryClient.invalidateQueries({
      predicate: ({ queryKey }) =>
        ['episodes', 'podcast', 'podcast-info'].includes(String(queryKey[0])) &&
        queryKey[1] === podcastId,
    });
    router.refresh();
  }, [dataUpdatedAt, podcastId, queryClient, router]);

  if (!empty || !isPending) return null;

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 'var(--space-12)',
        color: 'var(--color-ink-secondary)',
        fontFamily: 'var(--font-sans)',
        fontSize: 'var(--text-base)',
      }}
    >
      {t('podcast.loadingEpisodes')}
    </div>
  );
}
