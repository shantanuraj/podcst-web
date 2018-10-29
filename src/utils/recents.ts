import { App, ISubscriptionsMap } from '../typings';

/**
 * Recent episodes helper for subscriptions
 */

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
export const recents = (subs: ISubscriptionsMap): App.IEpisodeInfo[] =>
  Object.keys(subs)
    .map(feed => subs[feed].episodes.slice(0, FEED_EPISODES_LIMIT))
    .reduce((acc, feedEpisodes) => [...acc, ...feedEpisodes], [])
    .sort((a, b) => (b.published || 0) - (a.published || 0))
    .slice(0, EPISODES_LIMIT);
