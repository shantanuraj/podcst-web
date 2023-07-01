/**
 * Podcast Search API
 */
import { NextRequest, NextResponse } from 'next/server';
import { DEFAULT_PODCASTS_LOCALE, ITUNES_API } from '../../../data/constants';
import { IPodcastSearchResult, iTunes } from '../../../types';
import { adaptResponse } from '../adapter';
import { feedToSearchResponse } from '../feed/format';
import { feed } from '../feed/feed';

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const term = params.get('term');
  const locale = params.get('locale') || DEFAULT_PODCASTS_LOCALE;
  if (!term) {
    return NextResponse.json(
      {
        message: 'parameter `term` cannot be empty',
      },
      { status: 400 },
    );
  }

  const res: IPodcastSearchResult[] = await (isURL(term)
    ? feed(term).then(feedToSearchResponse(term))
    : searchFromApi(term, locale));

  return NextResponse.json(res);
}

/**
 * Url check regex
 */
const URL_REGEX = /^https?\:\//;

/**
 * Returns true if given string is url-like
 */
const isURL = (str: string) => URL_REGEX.test(str);

/**
 * Returns list of podcasts from search
 */
async function searchFromApi(term: string, locale: string): Promise<IPodcastSearchResult[]> {
  try {
    const url = getSearchUrl(term, locale);
    const res = await fetch(url);
    if (res.status !== 200) {
      console.error('Could not perform search:', term);
      return [];
    }
    const data = (await res.json()) as iTunes.Response;
    return adaptResponse(data);
  } catch (err) {
    console.error(err);
    return [];
  }
}

function getSearchUrl(term: string, locale: string) {
  const url = new URL(ITUNES_API);
  url.pathname = '/search';
  const params = new URLSearchParams({
    country: locale,
    media: 'podcast',
    term,
  });
  url.search = params.toString();
  return url.toString();
}
