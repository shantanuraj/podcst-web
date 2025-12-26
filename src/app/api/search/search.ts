import { adaptResponse } from '@/app/api/adapter';
import { feed } from '@/app/api/feed/feed';
import { feedToSearchResponse } from '@/app/api/feed/format';
import { DEFAULT_PODCASTS_LOCALE, ITUNES_API } from '@/data/constants';
import { searchPodcasts, searchPodcastsByFeedUrl } from '@/server/search';
import type { IPodcastSearchResult, iTunes } from '@/types';

export async function search(term: string, locale = DEFAULT_PODCASTS_LOCALE) {
  if (isURL(term)) {
    return searchByUrl(term);
  }
  return searchByTerm(term, locale);
}

async function searchByUrl(url: string): Promise<IPodcastSearchResult[]> {
  const dbResult = await searchPodcastsByFeedUrl(url);
  if (dbResult) {
    return [dbResult];
  }

  const feedResult = await feed(url);
  return feedToSearchResponse(url)(feedResult);
}

async function searchByTerm(
  term: string,
  locale: string,
): Promise<IPodcastSearchResult[]> {
  const itunesResults = await searchFromItunes(term, locale).catch(
    () => [] as IPodcastSearchResult[],
  );

  return itunesResults;
}

function mergeResults(
  dbResults: IPodcastSearchResult[],
  itunesResults: IPodcastSearchResult[],
): IPodcastSearchResult[] {
  const seen = new Set<string>();
  const merged: IPodcastSearchResult[] = [];

  for (const result of dbResults) {
    seen.add(result.feed);
    merged.push(result);
  }

  for (const result of itunesResults) {
    if (!seen.has(result.feed)) {
      seen.add(result.feed);
      merged.push(result);
    }
  }

  return merged;
}

const URL_REGEX = /^https?:\//;
const isURL = (str: string) => URL_REGEX.test(str);

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
