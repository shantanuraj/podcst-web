import useSWR from 'swr';

import { FeedType, IPodcast } from '../types';
import { get } from './api';

export const fetchFeed = async (type: FeedType) => {
  try {
    return get<IPodcast[]>(`/${type}`, { limit: 100 });
  } catch (err) {
    console.error(`Api.feed`, `Couldn't fetch feed`, err);
    throw err;
  }
};

export const useFeed = (type: FeedType) => {
  const response = useSWR(type, fetchFeed, { suspense: true });
  return response;
};
