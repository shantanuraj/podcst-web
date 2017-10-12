/**
 * TextShare API
 */

import {
  Observable,
} from 'rxjs/Observable';
import { ajax } from 'rxjs/observable/dom/ajax';

import {
  patchEpisodesResponse,
} from '../utils';

export default class Podcasts {
  private static HOST = 'https://data.podcst.io';

  private static api(url: string = '/') {
    return {
      crossDomain: true,
      responseType: 'json',
      url: `${Podcasts.HOST}${url}`,
    };
  }

  public static feed(type: FeedType): Observable<App.Podcast[]> {
    return ajax(Podcasts.api(`/${type}?limit=100`))
      .map((res) => res.response as App.Podcast[])
      .catch(() => {
        return Observable.of([]);
      });
  }

  public static search(term: string): Observable<App.Podcast[]> {
    return ajax(Podcasts.api(`/search?term=${encodeURIComponent(term)}`))
      .map((res) => res.response as App.Podcast[])
      .catch(() => {
        return Observable.of([]);
      });
  }

  public static episodes(url: string): Observable<App.PodcastEpisodesInfo | null> {
    const patchRes = patchEpisodesResponse(url);
    return ajax(Podcasts.api(`/feed?url=${encodeURIComponent(url)}`))
      .map((res) => res.response as App.EpisodeListing | null)
      .map(patchRes)
      .catch(() => {
        return Observable.of(null);
      });
  }
}
