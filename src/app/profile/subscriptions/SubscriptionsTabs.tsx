'use client';

import { useState } from 'react';
import { PodcastsGrid } from '@/ui/PodcastsGrid';
import { EpisodesList } from '@/ui/EpisodesList';
import type { IEpisodeInfo, IPodcastEpisodesInfo } from '@/types';

import styles from './Subscriptions.module.css';

type Tab = 'subscriptions' | 'new';

interface Props {
  podcasts: IPodcastEpisodesInfo[];
  episodes: IEpisodeInfo[];
}

export function SubscriptionsTabs({ podcasts, episodes }: Props) {
  const [activeTab, setActiveTab] = useState<Tab>('subscriptions');

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
            Subscriptions
          </button>
          <button
            type="button"
            className={styles.tab}
            data-active={activeTab === 'new'}
            onClick={() => setActiveTab('new')}
          >
            New Releases
          </button>
        </nav>
      </header>
      {activeTab === 'subscriptions' && <PodcastsGrid podcasts={podcasts} />}
      {activeTab === 'new' && <EpisodesList episodes={episodes} />}
    </>
  );
}
