/**
 * Keyboard shortcuts epic root
 */

import { fromEvent } from 'rxjs';

import { filter, map, switchMap, takeUntil } from 'rxjs/operators';

import { Epic } from 'redux-observable';

import { getEpisodeRoute, isNotIgnoreElement } from '../utils';

import { Actions, IState } from './root';

import { effect } from './utils';

import { Keys } from '../utils/constants';

import { APP_INIT, changeTheme, IChangeThemeAction } from './app';

import {
  IManualSeekUpdateAction,
  jumpSeek,
  manualSeekUpdate,
  pauseEpisode,
  PLAY_EPISODE,
  resumeEpisode,
  skipToNextEpisode,
  skipToPrevEpisode,
  STOP_EPISODE,
} from './player';

import { navigate } from './router';

import { toggleDrawer } from './drawer';

import { IKeyboardShortcutsMap } from '../typings';

/**
 * Keyboard shortcut map for changing theme
 */
const ChangeThemeKeys: IKeyboardShortcutsMap = {
  [Keys.t]: 'change-theme',
};

/**
 * Theme change shortcut epic
 */
export const changeThemeEpic: Epic<Actions, IChangeThemeAction, IState> = (action$, state$) =>
  action$.ofType(APP_INIT).pipe(
    switchMap(() =>
      fromEvent<KeyboardEvent>(document, 'keyup').pipe(
        filter(event => !!ChangeThemeKeys[event.keyCode] && isNotIgnoreElement(event.target)),
        map(() => changeTheme(state$.value.app.mode === 'dark' ? 'light' : 'dark')),
      ),
    ),
  );

/**
 * Keyboard shortcut map for controlling map
 */
const PlayerControlKeys: IKeyboardShortcutsMap = {
  [Keys.space]: 'play',
  [Keys.p]: 'prev',
  [Keys.n]: 'next',
  [Keys.left]: 'seek-back',
  [Keys.right]: 'seek-forward',
  [Keys.e]: 'episode-info',
};

/**
 * Is Seek key if its between 0-9
 */
const isSeekKey = (keyCode: number) => keyCode >= 48 && keyCode <= 57;

/**
 * Player seekbar jump-controls epic
 */
export const seekbarJumpsEpic: Epic<Actions, IManualSeekUpdateAction, IState> = (action$, state$) =>
  action$.ofType(PLAY_EPISODE).pipe(
    switchMap(() =>
      fromEvent<KeyboardEvent>(document, 'keyup').pipe(
        filter(({ keyCode, target }) => isSeekKey(keyCode) && isNotIgnoreElement(target)),
        map(e => {
          const { duration } = state$.value.player;
          const seekPercent = (e.keyCode - 48) / 10;
          const seekTo = duration * seekPercent;
          return manualSeekUpdate(seekTo, duration);
        }),
      ),
    ),
  );

/**
 * Player controls epic
 */
export const playerControlsEpic: Epic<Actions, Actions, IState> = (action$, state$) =>
  action$.ofType(PLAY_EPISODE).pipe(
    switchMap(() =>
      fromEvent<KeyboardEvent>(document, 'keydown').pipe(
        filter(({ keyCode, target }) => !!PlayerControlKeys[keyCode] && isNotIgnoreElement(target)),
        map(e => {
          const { state, currentEpisode, queue } = state$.value.player;

          // Space for scroll check
          if (!(e.keyCode === 32 && state === 'stopped')) {
            e.preventDefault();
          }

          const episode = queue[currentEpisode];
          const shortcut = PlayerControlKeys[e.keyCode];
          switch (shortcut) {
            case 'play':
              return state === 'paused' ? resumeEpisode() : pauseEpisode();
            case 'next':
              return skipToNextEpisode();
            case 'prev':
              return skipToPrevEpisode();
            case 'seek-back':
            case 'seek-forward':
              return jumpSeek(shortcut);
            case 'episode-info':
              if (state !== 'stopped' && !!episode) {
                const { feed, title } = episode;
                return navigate(getEpisodeRoute(feed, title));
              } else {
                return effect({ epic: 'playerControlsEpic' });
              }
            default:
              return effect({
                epic: 'playerControlsEpic',
                error: true,
                payload: shortcut,
              });
          }
        }),
        takeUntil(action$.ofType(STOP_EPISODE)),
      ),
    ),
  );

/**
 * Keyboard shortcut map for opening settings
 */
const OpenViewKeys: IKeyboardShortcutsMap = {
  [Keys.comma]: 'settings',
  [Keys.d]: 'toggle-drawer',
};

/**
 * Open settings epic
 */
export const openViewEpic: Epic<Actions, Actions, IState> = action$ =>
  action$.ofType(APP_INIT).pipe(
    switchMap(() =>
      fromEvent<KeyboardEvent>(document, 'keydown').pipe(
        filter(({ keyCode, target }) => !!OpenViewKeys[keyCode] && isNotIgnoreElement(target)),
        map(({ keyCode }) => {
          switch (OpenViewKeys[keyCode]) {
            case 'settings':
              return navigate('/settings');
            case 'toggle-drawer':
              return toggleDrawer();
            default:
              return effect({
                epic: 'openViewEpic',
                error: true,
                payload: keyCode,
              });
          }
        }),
      ),
    ),
  );
