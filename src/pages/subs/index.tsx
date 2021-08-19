import { NextPage } from 'next';

import { SubscriptionsState, useSubscriptions } from '../../shared/subscriptions/useSubscriptions';
import { ImportButton } from '../../components/ImportButton/ImportButton';
import { PodcastsGrid } from '../../ui/PodcastsGrid';

import styles from './Subscriptions.module.css';

const SubscriptionPage: NextPage = () => {
  const podcasts = useSubscriptions(getPodcastsList);
  const addSubscriptions = useSubscriptions(getAddSubscriptions);

  if (typeof window === 'undefined') return <div suppressHydrationWarning />;

  if (podcasts.length) return <PodcastsGrid podcasts={podcasts} />;
  return (
    <div className={styles.container}>
      <ImportButton onImport={addSubscriptions} />
    </div>
  );
};

export default SubscriptionPage;

const getPodcastsList = (state: SubscriptionsState) => Object.values(state.subs);
const getAddSubscriptions = (state: SubscriptionsState) => state.addSubscriptions;
