import type postgres from 'postgres';
import { DEFAULT_PODCASTS_LOCALE, ITUNES_API } from '../../data/constants';
import { indexPodcast } from './index-podcast';

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
  const [existing] = await sql`
    SELECT id FROM podcasts WHERE itunes_id = ${itunesId}
  `;
  if (existing) return Number(existing.id);

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
  const feed = new URL(podcast.feedUrl);
  if (
    !['http:', 'https:'].includes(feed.protocol) ||
    feed.username ||
    feed.password
  ) {
    throw new Error('Apple returned an invalid feed URL');
  }
  return indexPodcast(sql, feed.href, itunesId);
}
