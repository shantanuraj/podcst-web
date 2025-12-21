'use client';

import Link from 'next/link';
import { NextPage } from 'next';
import { useShallow } from 'zustand/react/shallow';

import { SubscriptionsState, useSubscriptions } from '@/shared/subscriptions/useSubscriptions';
import { ImportButton } from '@/components/ImportButton/ImportButton';
import { PodcastsGrid } from '@/ui/PodcastsGrid';

import styles from './Subscriptions.module.css';

const SubscriptionPage: NextPage = () => {
  const podcasts = useSubscriptions(useShallow(getPodcastsList));
  const addSubscriptions = useSubscriptions(getAddSubscriptions);

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
        <h1 className={styles.emptyTitle}>Your Library is Empty</h1>
        <p className={styles.emptyText}>
          Subscribe to podcasts to build your personal library, or import your existing
          subscriptions from another app.
        </p>
        <div className={styles.emptyActions}>
          <ImportButton onImport={addSubscriptions} className={styles.importButton} />
          <Link href="/feed/top" className={styles.browseLink}>
            Browse popular podcasts
          </Link>
        </div>
      </div>
    );
  }

  return <PodcastsGrid podcasts={podcasts} title="Subscriptions" />;
};

export default SubscriptionPage;

const getPodcastsList = (state: SubscriptionsState) => Object.values(state.subs);
const getAddSubscriptions = (state: SubscriptionsState) => state.addSubscriptions;
