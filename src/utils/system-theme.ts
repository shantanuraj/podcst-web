/**
 * System theme utils
 */

import { fromEventPattern, Observable } from 'rxjs';
import { map } from 'rxjs/operators';

import { App } from '../typings';

/**
 * System theme media query
 */
export const prefersLightTheme = matchMedia('(prefers-color-scheme: light)');

type ThemeListener = (this: MediaQueryList, ev: MediaQueryListEvent) => MediaQueryList;

function addThemeChangeListener(handler: ThemeListener) {
  prefersLightTheme.addListener(handler);
}

function removeThemeChangeListener(handler: ThemeListener) {
  prefersLightTheme.removeListener(handler);
}

/**
 * System theme change observable
 */
const prefersLightTheme$ = fromEventPattern<MediaQueryList>(addThemeChangeListener, removeThemeChangeListener);

export const systemThemeMode$: Observable<App.ThemeMode> = prefersLightTheme$.pipe(
  map(mq => (mq.matches ? 'light' : 'dark')),
);
