import { cache, isCached } from '@/app/api/redis';
import { DEFAULT_PODCASTS_LOCALE } from '@/data/constants';
import { getTopPodcasts as getTopFromDb } from '@/server/ingest/top';

export async function top(limit: number, locale = DEFAULT_PODCASTS_LOCALE) {
  const redisData = await cache.top(limit, locale);
  if (isCached(redisData) && redisData.entity.length > 0) {
    return redisData.entity;
  }

  const podcasts = await getTopFromDb(limit, locale);
  if (podcasts.length > 0) {
    cache.saveTop(podcasts, locale);
  }

  return podcasts;
}
