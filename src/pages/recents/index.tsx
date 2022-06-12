import { NextPage } from 'next';
import * as React from 'react';

import {
  getInit,
  SubscriptionsState,
  useSubscriptions,
} from '../../shared/subscriptions/useSubscriptions';
import { IEpisodeInfo } from '../../types';
import { EpisodesList } from '../../ui/EpisodesList';
import { LoadBar } from '../../ui/LoadBar';

import styles from './Recents.module.css';

const RecentsPage: NextPage = () => {
  const init = useSubscriptions(getInit);
  const isSyncing = useSubscriptions(getIsSyncing);
  const syncAllSubscriptions = useSubscriptions(getSyncSubscriptions);
  const episodes = useSubscriptions(getRecents);

  React.useEffect(() => {
    if (typeof window === 'undefined') return;
    init().then(syncAllSubscriptions);
  }, []);

  if (episodes.length) {
    return (
      <React.Fragment>
        {isSyncing && <LoadBar />}
        <EpisodesList episodes={episodes} />
      </React.Fragment>
    );
  }
  return (
    <div className={styles.container}>
      Subscribe to a few podcasts to see their episodes in the recents list.
    </div>
  );
};

export default RecentsPage;

/**
 * Per feed episodes limit for recents
 */
const FEED_EPISODES_LIMIT = 4;

/**
 * Total limit on recent episodes
 */
const EPISODES_LIMIT = 50;

/**
 * Returns list of episodes sorted by publish date in descending order
 * @param subs - User Subcriptions
 */
export const getRecents = (state: SubscriptionsState): IEpisodeInfo[] =>
  Object.keys(state.subs)
    .map((feed) => state.subs[feed].episodes.slice(0, FEED_EPISODES_LIMIT))
    .reduce((acc, feedEpisodes) => [...acc, ...feedEpisodes], [])
    .sort((a, b) => (b.published || 0) - (a.published || 0))
    .slice(0, EPISODES_LIMIT);

const getSyncSubscriptions = (state: SubscriptionsState) => state.syncAllSubscriptions;

const getIsSyncing = (state: SubscriptionsState) => state.isSyncing;
