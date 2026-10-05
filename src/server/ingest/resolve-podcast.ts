import type postgres from 'postgres';
import { DEFAULT_PODCASTS_LOCALE } from '../../data/constants';
import { lookupAppleListing } from './apple-listing';
import { indexPodcast } from './index-podcast';

type Fetch = (url: string, init: RequestInit) => Promise<Response>;

export async function resolvePodcast(
  sql: postgres.Sql,
  itunesId: number,
  locale = DEFAULT_PODCASTS_LOCALE,
  request: Fetch = fetch,
): Promise<number | null> {
  const listing = await lookupAppleListing(itunesId, locale, request);
  if (!listing) return null;
  return indexPodcast(sql, listing.feedUrl, itunesId, undefined, listing);
}
