'use client';

import { type ReactNode, useState } from 'react';
import { useTranslation } from '@/shared/i18n';
import { useStars } from '@/shared/stars/useStars';
import type { IEpisodeInfo, IPodcastEpisodesInfo } from '@/types';
import { EpisodesList } from '@/ui/EpisodesList';
import { PodcastsGrid } from '@/ui/PodcastsGrid';
import styles from './Subscriptions.module.css';

type Tab = 'subscriptions' | 'new' | 'starred';

interface Props {
  podcasts: IPodcastEpisodesInfo[];
  episodes: IEpisodeInfo[];
  emptyState: ReactNode;
}

export function SubscriptionsTabs({ podcasts, episodes, emptyState }: Props) {
  const [activeTab, setActiveTab] = useState<Tab>('subscriptions');
  const { t } = useTranslation();
  const starred = useStars();

  return (
    <>
      <header className={styles.header}>
        <nav className={styles.tabs}>
          <button
            type="button"
            className={styles.tab}
            data-active={activeTab === 'subscriptions'}
            onClick={() => setActiveTab('subscriptions')}
          >
            {t('profile.subscriptions')}
          </button>
          <button
            type="button"
            className={styles.tab}
            data-active={activeTab === 'new'}
            onClick={() => setActiveTab('new')}
          >
            {t('feed.newReleases')}
          </button>
          <button
            type="button"
            className={styles.tab}
            data-active={activeTab === 'starred'}
            onClick={() => setActiveTab('starred')}
          >
            {t('library.starred')}
            {starred.initialized && ` (${starred.episodes.length})`}
          </button>
        </nav>
      </header>
      {activeTab === 'subscriptions' &&
        (podcasts.length ? <PodcastsGrid podcasts={podcasts} /> : emptyState)}
      {activeTab === 'new' && <EpisodesList episodes={episodes} />}
      {activeTab === 'starred' &&
        (starred.episodes.length ? (
          <EpisodesList episodes={starred.episodes} />
        ) : (
          <div className={styles.empty}>
            <h1 className={styles.emptyTitle}>{t('library.starredEmpty')}</h1>
            <p className={styles.emptyText}>
              {t('library.starredEmptyDescription')}
            </p>
          </div>
        ))}
    </>
  );
}
