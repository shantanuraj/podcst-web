import { adaptResponse } from '@/app/api/adapter';
import { DEFAULT_PODCASTS_LOCALE, ITUNES_API } from '@/data/constants';
import { sql } from '@/server/db';
import {
  indexPrivatePodcast,
  PodcastAccessDenied,
} from '@/server/ingest/index-podcast';
import { matchSearchResults, searchPodcastsByFeedUrl } from '@/server/search';
import { feedUrl, isFeedUrlInput } from '@/shared/feed-url';
import type { IPodcastSearchResult, iTunes } from '@/types';

export async function search(
  term: string,
  locale = DEFAULT_PODCASTS_LOCALE,
  userId: string | null = null,
) {
  if (isFeedUrlInput(term)) {
    if (!userId) throw new PodcastAccessDenied('Sign in to open an RSS link');
    const url = feedUrl(term);
    await indexPrivatePodcast(sql, url, userId);
    const result = await searchPodcastsByFeedUrl(sql, url, userId);
    return result ? [result] : [];
  }
  return searchByTerm(term, locale);
}

async function searchByTerm(
  term: string,
  locale: string,
): Promise<IPodcastSearchResult[]> {
  const itunesResults = await searchFromItunes(term, locale).catch(
    () => [] as IPodcastSearchResult[],
  );

  return matchSearchResults(sql, itunesResults);
}

async function searchFromItunes(
  term: string,
  locale: string,
): Promise<IPodcastSearchResult[]> {
  const url = new URL(ITUNES_API);
  url.pathname = '/search';
  url.search = new URLSearchParams({
    country: locale,
    media: 'podcast',
    term,
  }).toString();

  const res = await fetch(url);
  if (!res.ok) return [];

  const data = (await res.json()) as iTunes.Response;
  return adaptResponse(data);
}
