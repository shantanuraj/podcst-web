/**
 * TextShare API
 */

import { Observable, of } from 'rxjs';
import { ajax } from 'rxjs/ajax';
import { catchError, map } from 'rxjs/operators';

import { App, FeedType } from '../typings';

import { patchEpisodesResponse } from '../utils';

export default class Podcasts {
  private static HOST = 'https://data.podcst.io';

  private static api(url: string = '/') {
    return {
      crossDomain: true,
      responseType: 'json',
      url: `${Podcasts.HOST}${url}`,
    };
  }

  public static feed(type: FeedType): Observable<App.IPodcast[]> {
    return ajax(Podcasts.api(`/${type}?limit=100`)).pipe(
      map(res => res.response as App.IPodcast[]),
      catchError(() => of([])),
    );
  }

  public static search(term: string): Observable<App.IPodcastSearchResult[]> {
    return ajax(Podcasts.api(`/search?term=${encodeURIComponent(term)}`)).pipe(
      map(res => res.response as App.IPodcastSearchResult[]),
      catchError(() => of([])),
    );
  }

  public static episodes(url: string): Observable<App.IPodcastEpisodesInfo | null> {
    const patchRes = patchEpisodesResponse(url);
    return ajax(Podcasts.api(`/feed?url=${encodeURIComponent(url)}`)).pipe(
      map(res => res.response as App.IEpisodeListing | null),
      map(patchRes),
      catchError(() => of(null)),
    );
  }
}
