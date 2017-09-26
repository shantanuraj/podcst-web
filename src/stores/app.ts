/**
 * App state
 * Theme actions / reducers
 * Manage Chrome for Android's media session state
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
  updateMetadata,
} from '../utils/chrome-media-utils';

import {
  fixGlobalStyles,
} from '../utils/styles';

import {
  ThemeProvider,
} from '../styles';

import {
  Actions,
  State,
} from './root';

import {
  PLAY_EPISODE,
  PlayEpisodeAction,
} from './player';

import {
  noop,
} from './utils';

interface UpdateChromeMetadataAction {
  type: 'UPDATE_CHROME_METADATA',
}
const UPDATE_CHROME_METADATA: UpdateChromeMetadataAction['type'] = 'UPDATE_CHROME_METADATA';
const updateChromeMetadatAction = (): UpdateChromeMetadataAction => ({
  type: UPDATE_CHROME_METADATA,
});

type ChangeTheme = 'CHANGE_THEME';
interface ChangeThemeAction {
  type: ChangeTheme,
  mode: App.ThemeMode,
}
const CHANGE_THEME: ChangeThemeAction['type'] = 'CHANGE_THEME';
export const changeTheme = (mode: App.ThemeMode): ChangeThemeAction => ({
  type: CHANGE_THEME,
  mode,
});

type AppInit = 'APP_INIT';
interface AppInitAction {
  type: AppInit,
}
const APP_INIT: AppInitAction['type'] = 'APP_INIT';
export const appInit = (): AppInitAction => ({
  type: APP_INIT,
});

export type AppActions =
  AppInitAction |
  UpdateChromeMetadataAction |
  ChangeThemeAction;

/**
 * App specific state
 */
export interface AppState {
  mode: App.ThemeMode;
  theme: App.Theme;
}

/**
 * Chrome MediaSession Metadata epic
 */
export const chromeMediaMetadaUpdateEpic: Epic<Actions, State> = action$ =>
  action$.ofType(PLAY_EPISODE)
    .do((action: PlayEpisodeAction) => updateMetadata(action.episode))
    .map(updateChromeMetadatAction);

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
    .switchMap(() =>
      Observable.fromEvent<KeyboardEvent>(document, 'keyup')
        .filter(event =>
          Key[event.keyCode] === 'change-theme' &&
          !(event.target as HTMLElement).matches(ignoreKeyboardSelector)
        )
        .map(() => changeTheme(
          store.getState().app.mode === 'dark' ? 'light' : 'dark',
        ))
    );

/**
 * On Theme change
 */
export const onThemeChangeEpic: Epic<Actions, State> = (action$, store) =>
    action$.ofType(CHANGE_THEME)
      .do(() => fixGlobalStyles(store.getState().app.theme))
      .map(noop);

/**
 * App reducer
 */
export const app = (state: AppState = {
  mode: 'dark',
  theme: ThemeProvider('dark'),
}, action: AppActions): AppState => {
  switch (action.type) {
    case CHANGE_THEME:
      return {...state, mode: action.mode, theme: ThemeProvider(action.mode)};
    default:
      return state;
  }
}
