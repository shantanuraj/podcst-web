import { adaptResponse } from '@/app/api/adapter';
import { cache, cacheMiss, isCached } from '@/app/api/redis';
import { CACHE_STALE_DELTA, DEFAULT_PODCASTS_LOCALE, ITUNES_API } from '@/data/constants';
import type { IPodcast, iTunes } from '@/types';

export async function top(limit: number, locale = DEFAULT_PODCASTS_LOCALE) {
  try {
    const res = await getTopPodcasts(limit, locale);
    return res.entity;
  } catch (err) {
    console.error('Failed to fetch top API from iTunes', err);
    throw err;
  }
}

/**
 * Get top data from redis or iTunes, using swr strategy
 */
async function getTopPodcasts(limit: number, locale: string) {
  try {
    const data = await cache.top(limit, locale);
    if (isCached(data) && data.entity.length > 0) {
      return data;
    }
    const podcasts = await getTopFromApi(limit, locale);
    cache.saveTop(podcasts, locale);
    return cacheMiss(podcasts);
  } catch (_err) {
    return cacheMiss([]);
  }
}

/**
 * Get top data from iTunes API
 */
async function getTopFromApi(limit: number, locale: string): Promise<IPodcast[]> {
  const url = getUrl(limit, locale);
  try {
    const res = await fetch(url, { next: { revalidate: CACHE_STALE_DELTA } });
    if (res.status !== 200) {
      return [];
    }
    const feedRes = (await res.json()) as iTunes.FeedResponse;
    const topIds = feedRes.feed.entry.map((p) => p.id.attributes['im:id']);
    return lookup(topIds);
  } catch (err) {
    console.error('Failed to fetch top API from iTunes', err);
  }
  return [];
}

/**
 * Generate url for RSS feed mapped to JSON, for the given limit
 */
const getUrl = (limit: number, locale: string) =>
  `${ITUNES_API}/${locale}/rss/toppodcasts/limit=${limit}/explicit=true/json`;

async function lookup(ids: string[]): Promise<IPodcast[]> {
  try {
    const url = getLookupUrl(ids);
    const res = await fetch(url, { next: { revalidate: CACHE_STALE_DELTA } });
    if (res.status !== 200) {
      return [];
    }
    const data = (await res.json()) as iTunes.Response;
    return adaptResponse(data);
  } catch (err) {
    console.error(err);
    return [];
  }
}

/**
 * Url for directory lookup based on id/s
 */
const getLookupUrl = (ids: string[]) => `${ITUNES_API}/lookup?id=${ids.join(',')}`;
