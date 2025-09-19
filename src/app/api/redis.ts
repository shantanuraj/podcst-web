import { Redis } from 'ioredis';

import {
  CACHE_STALE_DELTA,
  KEY_PARSED_FEED,
  KEY_TOP_PODCASTS,
  KEY_SHORT_URL,
} from '@/data/constants';
import { IEpisodeListing, IPodcast, IShortUrl } from '@/types';

/**
 * Redis cached entity with timestamp
 */
export interface CachedEntity<T> {
  timestamp: number;
  entity: T;
}

/**
 * Cache response typewrapper
 */
type CacheResponse<T> = Promise<CachedEntity<T>>;

/**
 * Cache miss helper
 */
export const cacheMiss = <T>(entity: T) => ({ entity, timestamp: 0 });

/**
 * Cache hit helper (removes nullability from return type)
 */
export const cacheHit = <T>(entry: CachedEntity<T | null>) => entry as CachedEntity<T>;

/**
 * Returns true if given object is a cache hit
 */
export const isCached = <T>(entry: CachedEntity<T>) => entry.timestamp !== 0;

/**
 * Redis key for feed
 */
const feedKey = (url: string) => `${KEY_PARSED_FEED}-${url.trim()}`;

/**
 * Redis key for short URL
 */
const shortUrlKey = (slug: string) => `${KEY_SHORT_URL}-${slug}`;

/**
 * Parse stringified JSON to Object
 */
const parse = <T>(val: string) => JSON.parse(val) as CachedEntity<T>;

/**
 * Convert Object to JSON string
 */
const stringify = <T>(val: CachedEntity<T>) => JSON.stringify(val);

const redis = new Redis({
  host: process.env.KV_REDIS_HOST,
  password: process.env.KV_REDIS_PASS,
  port: parseInt(process.env.KV_REDIS_PORT || '0', 10),
});

/**
 * Save key, value pair to redis
 */
const save = async <T>(key: string, value: T) => {
  return redis
    .set(
      key,
      stringify({
        entity: value,
        timestamp: Date.now(),
      }),
    )
    .catch(console.error);
};

/**
 * Read from redis checks if stored key is stale or fresh
 */
const read = async <T>(key: string): CacheResponse<T | null> => {
  try {
    const res = await redis.get(key);
    if (!res) {
      return cacheMiss(null);
    }
    const cached = parse<T>(res);
    const { timestamp } = cached;
    if (
      Date.now() - timestamp <=
      CACHE_STALE_DELTA // Cache is fresh
    ) {
      return cached;
    } else {
      return cacheMiss(null); // Cache is stale
    }
  } catch (err) {
    console.error(err);
    return cacheMiss(null);
  }
};

const keys = {
  top: (locale: string) => `${KEY_TOP_PODCASTS}/${locale}`,
};

/**
 * Cache helper module
 */
export const cache = {
  /**
   * Get top podcasts from redis cache
   */
  async top(count: number, locale: string) {
    try {
      let cached = await read<IPodcast[]>(keys.top(locale));
      if (cached.entity && cached.entity.length >= count) {
        cached.entity = cached.entity.slice(0, count);
        return cacheHit(cached);
      } else {
        return cacheMiss([]);
      }
    } catch (err) {
      console.error(err);
      return cacheMiss([]);
    }
  },

  /**
   * Set top podcasts in redis cache
   */
  async saveTop(podcasts: IPodcast[], locale: string) {
    return save(keys.top(locale), podcasts);
  },

  /**
   * Get parsed feed from redis cache
   */
  async feed(url: string) {
    try {
      const cached = await read<IEpisodeListing>(feedKey(url));
      return cached;
    } catch (err) {
      console.error(err);
      return cacheMiss(null);
    }
  },

  /**
   * Set top podcasts in redis cache
   */
  async saveFeed(url: string, feed: IEpisodeListing) {
    return save(feedKey(url), feed);
  },

  /**
   * Get short URL mapping from redis (permanent storage)
   */
  async getShortUrl(slug: string) {
    try {
      const res = await redis.get(shortUrlKey(slug));
      if (!res) {
        return null;
      }
      const cached = parse<IShortUrl>(res);
      return cached.entity;
    } catch (err) {
      console.error(err);
      return null;
    }
  },

  /**
   * Save short URL mapping in redis (permanent storage)
   */
  async saveShortUrl(slug: string, shortUrl: IShortUrl) {
    return redis.set(
      shortUrlKey(slug),
      stringify({
        entity: shortUrl,
        timestamp: Date.now(),
      }),
    );
  },
};
