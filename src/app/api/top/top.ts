import { cache, isCached } from '@/app/api/redis';
import { DEFAULT_PODCASTS_LOCALE } from '@/data/constants';
import { sql } from '@/server/db';
import { requestChartRefresh } from '@/server/ingest/chart-regions';
import {
  getTopPodcasts as getTopFromDb,
  publicTopPodcasts,
} from '@/server/ingest/top';

export async function top(limit: number, locale = DEFAULT_PODCASTS_LOCALE) {
  const [redisData] = await Promise.all([
    cache.top(limit, locale),
    requestChartRefresh(sql, locale).catch((error) =>
      console.error(
        `[charts:${locale}] Refresh request failed: ${error instanceof Error ? error.message : String(error)}`,
      ),
    ),
  ]);
  if (isCached(redisData) && redisData.entity.length > 0) {
    const publicPodcasts = await publicTopPodcasts(redisData.entity);
    if (publicPodcasts.length === redisData.entity.length)
      return publicPodcasts;
  }

  const podcasts = await getTopFromDb(limit, locale);
  if (podcasts.length > 0) {
    cache.saveTop(podcasts, locale);
  }

  return podcasts;
}
