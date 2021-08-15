import { NextPage } from 'next';
import * as React from 'react';

import { SubscriptionsState, useSubscriptions } from '../../shared/subscriptions/useSubscriptions';
import { IEpisodeInfo } from '../../types';
import { EpisodesList } from '../../ui/EpisodesList';

import styles from './Recents.module.css';

const RecentsPage: NextPage = () => {
  const episodes = useSubscriptions(getRecents);

  if (typeof window === 'undefined') return <div suppressHydrationWarning />;

  if (episodes.length) return <EpisodesList episodes={episodes} />;
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
