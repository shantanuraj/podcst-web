import { FeedType, IPodcast } from '../types';
import { get } from './api';
import { FEED_REVALIDATE_DURATION } from './constants';

export const fetchFeed = async (type: FeedType) => {
  try {
    return get<IPodcast[]>(`/${type}`, { limit: 100 }, FEED_REVALIDATE_DURATION);
  } catch (err) {
    console.error(`Api.feed`, `Couldn't fetch feed`, err);
    throw err;
  }
};
