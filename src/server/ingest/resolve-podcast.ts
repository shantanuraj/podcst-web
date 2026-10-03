import type postgres from 'postgres';
import { DEFAULT_PODCASTS_LOCALE, ITUNES_API } from '../../data/constants';
import { feedUrl } from '../../shared/feed-url';
import { indexPodcast } from './index-podcast';
import { appleIdentities, PodcastIdentityConflict } from './podcast-identity';

type Fetch = (url: string, init: RequestInit) => Promise<Response>;

export async function resolvePodcast(
  sql: postgres.Sql,
  itunesId: number,
  locale = DEFAULT_PODCASTS_LOCALE,
  request: Fetch = fetch,
): Promise<number | null> {
  if (!Number.isSafeInteger(itunesId) || itunesId <= 0) {
    throw new TypeError('itunes_id must be a positive integer');
  }
  const existing = await sql`${appleIdentities(sql, [itunesId])}`;
  if (existing.length > 1)
    throw new PodcastIdentityConflict(
      'Apple identity identifies multiple sources',
    );
  if (existing[0]) return Number(existing[0].id);

  const url = new URL('/lookup', ITUNES_API);
  url.search = new URLSearchParams({
    id: String(itunesId),
    entity: 'podcast',
    country: locale,
  }).toString();
  const response = await request(url.href, {
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`Apple returned HTTP ${response.status}`);
  const data = await response.json();
  if (!Array.isArray(data?.results)) {
    throw new Error('Apple returned an invalid lookup response');
  }
  const podcast = data.results.find(
    (result: { collectionId?: number; kind?: string }) =>
      result?.collectionId === itunesId && result.kind === 'podcast',
  );
  if (!podcast) return null;
  return indexPodcast(sql, feedUrl(podcast.feedUrl), itunesId, undefined, {
    country: locale,
    verifiedAt: new Date().toISOString(),
  });
}
