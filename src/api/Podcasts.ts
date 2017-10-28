/**
 * TextShare API
 */

import { Observable } from 'rxjs/Observable';
import { ajax } from 'rxjs/observable/dom/ajax';
import { of } from 'rxjs/observable/of';

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
    return ajax(Podcasts.api(`/${type}?limit=100`))
      .map(res => res.response as App.IPodcast[])
      .catch(() => of([]));
  }

  public static search(term: string): Observable<App.IPodcastSearchResult[]> {
    return ajax(Podcasts.api(`/search?term=${encodeURIComponent(term)}`))
      .map(res => res.response as App.IPodcastSearchResult[])
      .catch(() => of([]));
  }

  public static episodes(url: string): Observable<App.IPodcastEpisodesInfo | null> {
    const patchRes = patchEpisodesResponse(url);
    return ajax(Podcasts.api(`/feed?url=${encodeURIComponent(url)}`))
      .map(res => res.response as App.IEpisodeListing | null)
      .map(patchRes)
      .catch(() => of(null));
  }
}
