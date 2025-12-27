'use client';

import type { NextPage } from 'next';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';

import { ImportButton } from '@/components/ImportButton/ImportButton';
import { useTranslation } from '@/shared/i18n';
import {
  getInit,
  type SubscriptionsState,
  useSubscriptions,
} from '@/shared/subscriptions/useSubscriptions';
import type { IEpisodeInfo } from '@/types';
import { EpisodesList } from '@/ui/EpisodesList';
import { LoadBar } from '@/ui/LoadBar';
import { PodcastsGrid } from '@/ui/PodcastsGrid';
import { ItemListSchema } from '@/components/Schema';

import styles from './Subscriptions.module.css';

type Tab = 'subscriptions' | 'new';

const LibraryPage: NextPage = () => {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState<Tab>('subscriptions');

  const init = useSubscriptions(getInit);
  const isSyncing = useSubscriptions(getIsSyncing);
  const syncAllSubscriptions = useSubscriptions(getSyncSubscriptions);
  const podcasts = useSubscriptions(useShallow(getPodcastsList));
  const episodes = useSubscriptions(useShallow(getRecents));
  const addSubscriptions = useSubscriptions(getAddSubscriptions);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    init().then(syncAllSubscriptions);
  }, [init, syncAllSubscriptions]);

  if (!podcasts.length) {
    return (
      <div className={styles.empty} suppressHydrationWarning>
        <div className={styles.emptyIcon}>
          <svg
            width="64"
            height="64"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
          >
            <path d="M19 11a7 7 0 0 1-7 7m0 0a7 7 0 0 1-7-7m7 7v4m0 0h-3m3 0h3M12 4a7 7 0 0 0-7 7m14 0a7 7 0 0 0-7-7" />
          </svg>
        </div>
        <h1 className={styles.emptyTitle}>{t('settings.emptyLibrary')}</h1>
        <p className={styles.emptyText}>
          {t('settings.emptyLibraryDescription')}
        </p>
        <div className={styles.emptyActions}>
          <ImportButton
            onImport={addSubscriptions}
            className={styles.importButton}
          />
          <Link href="/feed/top" className={styles.browseLink}>
            {t('settings.browsePopularPodcasts')}
          </Link>
        </div>
      </div>
    );
  }

  return (
    <>
      {isSyncing && <LoadBar />}
      <header className={styles.header}>
        <nav className={styles.tabs}>
          <button
            type="button"
            className={styles.tab}
            data-active={activeTab === 'subscriptions'}
            onClick={() => setActiveTab('subscriptions')}
          >
            {t('library.subscriptions')}
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
      {activeTab === 'subscriptions' && (
        <>
          <ItemListSchema items={podcasts} title={t('library.subscriptions')} />
          <PodcastsGrid podcasts={podcasts} />
        </>
      )}
      {activeTab === 'new' && <EpisodesList episodes={episodes} />}
    </>
  );
};

export default LibraryPage;

const FEED_EPISODES_LIMIT = 4;
const EPISODES_LIMIT = 50;

const getPodcastsList = (state: SubscriptionsState) =>
  Object.values(state.subs);
const getAddSubscriptions = (state: SubscriptionsState) =>
  state.addSubscriptions;
const getSyncSubscriptions = (state: SubscriptionsState) =>
  state.syncAllSubscriptions;
const getIsSyncing = (state: SubscriptionsState) => state.isSyncing;

const getRecents = (state: SubscriptionsState): IEpisodeInfo[] =>
  Object.keys(state.subs)
    .flatMap((feed) => state.subs[feed].episodes.slice(0, FEED_EPISODES_LIMIT))
    .sort((a, b) => (b.published || 0) - (a.published || 0))
    .slice(0, EPISODES_LIMIT);
