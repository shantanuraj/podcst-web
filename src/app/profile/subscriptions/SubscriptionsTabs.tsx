'use client';

import { useState } from 'react';
import type { IEpisodeInfo, IPodcastEpisodesInfo } from '@/types';
import { EpisodesList } from '@/ui/EpisodesList';
import { PodcastsGrid } from '@/ui/PodcastsGrid';

import styles from './Subscriptions.module.css';
import { useTranslation } from '@/shared/i18n';

type Tab = 'subscriptions' | 'new';

interface Props {
  podcasts: IPodcastEpisodesInfo[];
  episodes: IEpisodeInfo[];
}

export function SubscriptionsTabs({ podcasts, episodes }: Props) {
  const [activeTab, setActiveTab] = useState<Tab>('subscriptions');
  const { t } = useTranslation();

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
        </nav>
      </header>
      {activeTab === 'subscriptions' && <PodcastsGrid podcasts={podcasts} />}
      {activeTab === 'new' && <EpisodesList episodes={episodes} />}
    </>
  );
}
