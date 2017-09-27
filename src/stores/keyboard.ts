/**
 * Keyboard shortcuts epic root
 */

import {
  Observable,
} from 'rxjs/Observable';

import {
  Epic,
} from 'redux-observable';

import {
  ignoreKeyboardSelector,
} from '../utils';

import {
  Actions,
  State,
} from './root';

import {
  APP_INIT,
  changeTheme,
} from './app';

/**
 * Keyboard shortcut map
 */
const Key: KeyboardShortcutsMap = {
  84: 'change-theme',
};

/**
 * Theme change shortcut epic
 */
export const changeThemeEpic: Epic<Actions, State> = (action$, store) =>
  action$.ofType(APP_INIT)
    .switchMap(() => Observable.fromEvent<KeyboardEvent>(document, 'keyup')
      .filter(event =>
        Key[event.keyCode] === 'change-theme' &&
        !(event.target as HTMLElement).matches(ignoreKeyboardSelector)
      )
      .map(() => changeTheme(
        store.getState().app.mode === 'dark' ? 'light' : 'dark',
      ))
    );
