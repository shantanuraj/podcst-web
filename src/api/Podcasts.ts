/**
 * TextShare API
 */

import {
  Observable,
} from 'rxjs/Observable';
import { ajax } from 'rxjs/observable/dom/ajax';

export default class Podcasts {
  private static HOST = 'https://data.podcst.io';

  private static api(url: string = '/') {
    return {
      url: `${Podcasts.HOST}${url}`,
      responseType: 'json',
      crossDomain: true,
    };
  }

  public static feed(type: FeedType): Observable<App.Podcast[]> {
    return ajax(Podcasts.api(`/${type}?limit=100`))
      .map((res) => res.response as App.Podcast[])
      .catch((err) => {
        console.error(err);
        return Observable.of([]);
      });
  }

  public static search(term: string): Observable<App.Podcast[]> {
    return ajax(Podcasts.api(`/search?term=${encodeURIComponent(term)}`))
      .map((res) => res.response as App.Podcast[])
      .catch((err) => {
        console.error(err);
        return Observable.of([]);
      });
  }

  public static episodes(url: string): Observable<App.EpisodeListing | null> {
    return ajax(Podcasts.api(`/feed?url=${encodeURIComponent(url)}`))
      .map((res) => res.response as App.EpisodeListing | null)
      .catch((err) => {
        console.error(err);
        return Observable.of(null);
      });
  }
}
