import { NextPage } from 'next';
import * as React from 'react';

import { useSubscriptions } from '../../shared/subscriptions/useSubscriptions';
import { ImportButton } from '../../components/ImportButton/ImportButton';
import { addSubscriptions } from '../../shared/subscriptions';
import { IPodcastEpisodesInfo } from '../../types';
import { PodcastsGrid } from '../../ui/PodcastsGrid';

import styles from './Subscriptions.module.css';

const SubscriptionPage: NextPage = () => {
  const { subs, dispatch } = useSubscriptions();
  const podcasts = React.useMemo(() => Object.values(subs), [subs]);

  const onImport = React.useCallback(
    (podcasts: IPodcastEpisodesInfo[]) => dispatch(addSubscriptions(podcasts)),
    [dispatch],
  );

  if (typeof window === 'undefined') return null;

  if (podcasts.length) return <PodcastsGrid podcasts={podcasts} />;
  return (
    <div className={styles.container}>
      <ImportButton onImport={onImport} />
    </div>
  );
};

export default SubscriptionPage;
