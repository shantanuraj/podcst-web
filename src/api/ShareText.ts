/**
 * TextShare API
 */

import { ajax } from 'rxjs/observable/dom/ajax';
import {
  Observable,
} from 'rxjs/Observable';

export default class ShareText {
  constructor(
    private host: string,
    private code: string,
  ) {}

  /**
   * Authorization header
   */
  static CODE_HEADER = 'x-text-code';

  /**
   * Success status code
   */
  static STATUS_SUCCESS = 200;

  private api(url: string = '/') {
    const headers = {
      [ShareText.CODE_HEADER]: this.code,
    };

    return {
      url: `${this.host}${url}`,
      headers,
      responseType: 'json',
      crossDomain: true,
    };
  }

  public getAuth(): Observable<boolean> {
    return ajax({ ...this.api(), responseType: 'text' })
      .map(res =>
        res.status === ShareText.STATUS_SUCCESS &&
        res.response === this.code
      )
      .catch(() => Observable.of(false));
  }

  public getTexts(): Observable<ShareText.Text[]> {
    return ajax(this.api('/texts'))
      .map(res => res.response as ShareTextApi.Texts)
      .map(res => res.texts)
      .catch(err => {
        console.error(err);
        return Observable.of([]);
      });
  }
}
