'use client';

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
