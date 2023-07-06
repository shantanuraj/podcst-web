'use client';

import { NextPage } from 'next';

import { SubscriptionsState, useSubscriptions } from '@/shared/subscriptions/useSubscriptions';
import { ImportButton } from '@/components/ImportButton/ImportButton';
import { PodcastsGrid } from '@/ui/PodcastsGrid';

import styles from './Subscriptions.module.css';

const SubscriptionPage: NextPage = () => {
  const podcasts = useSubscriptions(getPodcastsList);
  const addSubscriptions = useSubscriptions(getAddSubscriptions);

  if (typeof window === 'undefined' || !podcasts.length) {
    return (
      <div className={styles.container} suppressHydrationWarning>
        <ImportButton onImport={addSubscriptions} />
      </div>
    );
  }

  return <PodcastsGrid podcasts={podcasts} />;
};

export default SubscriptionPage;

const getPodcastsList = (state: SubscriptionsState) => Object.values(state.subs);
const getAddSubscriptions = (state: SubscriptionsState) => state.addSubscriptions;
