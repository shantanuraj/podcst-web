/**
 * Recent episodes helper for subscriptions
 */

/**
 * Per feed episodes limit for recents
 */
const FEED_EPISODES_LIMIT = 4;

/**
 * Returns list of episodes sorted by publish date in descending order
 * @param subs - User Subcriptions
 */
export const recents = (subs: ISubscriptionsMap): App.IEpisodeInfo[] => {
  const episodes = Object.keys(subs)
    .map(feed => subs[feed].episodes.slice(0, FEED_EPISODES_LIMIT))
    .reduce((acc, feedEpisodes) => [...acc, ...feedEpisodes], []);

  return episodes.slice().sort((a, b) => (b.published || 0) - (a.published || 0));
};
