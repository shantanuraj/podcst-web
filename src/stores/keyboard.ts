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
  noop,
} from './utils';

import {
  APP_INIT,
  changeTheme,
} from './app';

import {
  PLAY_EPISODE,
  STOP_EPISODE,
  pauseEpisode,
  resumeEpisode,
  skipToNextEpisode,
  skipToPrevEpisode,
} from './player';

/**
 * Keyboard shortcut map for changing theme
 */
const ChangeThemeKeys: KeyboardShortcutsMap = {
  84: 'change-theme',
};

/**
 * Theme change shortcut epic
 */
export const changeThemeEpic: Epic<Actions, State> = (action$, store) =>
  action$.ofType(APP_INIT)
    .switchMap(() => Observable.fromEvent<KeyboardEvent>(document, 'keyup')
      .filter(event =>
        !!ChangeThemeKeys[event.keyCode] &&
        !(event.target as HTMLElement).matches(ignoreKeyboardSelector)
      )
      .map(() => changeTheme(
        store.getState().app.mode === 'dark' ? 'light' : 'dark',
      ))
    );

/**
 * Keyboard shortcut map for controlling map
 */
const PlayerControlKeys: KeyboardShortcutsMap = {
  32: 'play',
  37: 'prev',
  80: 'prev',
  39: 'next',
  78: 'next',
};

/**
 * Player controls epic
 */
export const playerControlsEpic: Epic<Actions, State> = (action$, store) =>
  action$.ofType(PLAY_EPISODE)
    .switchMap(() => Observable.fromEvent<KeyboardEvent>(document, 'keydown')
      .filter(({ keyCode, target }) =>
        !(target as HTMLElement).matches(ignoreKeyboardSelector) &&
        !!PlayerControlKeys[keyCode]
      )
      .map((e) => {
        const { state } = store.getState().player;

        // Space for scroll check
        if (!(e.keyCode === 32 && state === 'stopped')) {
          e.preventDefault();
        }

        switch(PlayerControlKeys[e.keyCode]) {
          case 'play': return state === 'paused' ? resumeEpisode() : pauseEpisode();
          case 'next': return skipToNextEpisode();
          case 'prev': return skipToPrevEpisode();
          default: return noop();
        }
      })
      .takeUntil(action$.ofType(STOP_EPISODE))
    )
