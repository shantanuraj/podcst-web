/**
 * Data caching module
 */
import { CACHE_STALE_DELTA } from '../../../data/constants';
import { IEpisodeListing } from '../../../types';
import { cache, cacheMiss, isCached } from '../redis';
import { adaptFeed } from './parser';

/**
 * Podcast feed lookup from redis or iTunes
 */
export async function feed(url: string) {
  try {
    const data = await cache.feed(url);
    if (isCached(data)) {
      return data.entity;
    }
    const feedData = await fetchFeed(url);
    if (feedData) {
      cache.saveFeed(url, feedData);
    }
    return cacheMiss(feedData).entity;
  } catch (err) {
    return cacheMiss(null).entity;
  }
}

/**
 * Returns list of podcasts from search
 */
async function fetchFeed(url: string): Promise<IEpisodeListing | null> {
  try {
    const res = await fetch(url, { next: { revalidate: CACHE_STALE_DELTA } });
    if (res.status !== 200) {
      console.error('Could not get episodes from:', url);
      return null;
    }
    const data = await res.text();
    return adaptFeed(data);
  } catch (err) {
    console.error(err);
    return null;
  }
}
