'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { feedRefreshOptions } from '@/data/feed-refresh';
import { useTranslation } from '@/shared/i18n';

interface Props {
  podcastId: number;
  empty?: boolean;
}

export function FeedRefresh({ podcastId, empty = false }: Props) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { t } = useTranslation();
  const { isPending } = useQuery(
    feedRefreshOptions(queryClient, podcastId, () => router.refresh(), empty),
  );

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
