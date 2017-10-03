/**
 * App state
 * Theme actions / reducers
 * Manage Chrome for Android's media session state
 */

import {
  Epic,
} from 'redux-observable';

import {
  updateMetadata,
} from '../utils/chrome-media-utils';

import {
  fixGlobalStyles,
} from '../utils/styles';

import {
  Storage,
} from '../utils/storage';

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
  type: 'UPDATE_CHROME_METADATA';
}
const UPDATE_CHROME_METADATA: UpdateChromeMetadataAction['type'] = 'UPDATE_CHROME_METADATA';
const updateChromeMetadatAction = (): UpdateChromeMetadataAction => ({
  type: UPDATE_CHROME_METADATA,
});

type ChangeTheme = 'CHANGE_THEME';
interface ChangeThemeAction {
  type: ChangeTheme;
  mode: App.ThemeMode;
}
const CHANGE_THEME: ChangeThemeAction['type'] = 'CHANGE_THEME';
export const changeTheme = (mode: App.ThemeMode): ChangeThemeAction => ({
  type: CHANGE_THEME,
  mode,
});

type AppInit = 'APP_INIT';
interface AppInitAction {
  type: AppInit;
}
export const APP_INIT: AppInitAction['type'] = 'APP_INIT';
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
export const chromeMediaMetadaUpdateEpic: Epic<Actions, State> = (action$) =>
  action$.ofType(PLAY_EPISODE)
    .do((action: PlayEpisodeAction) => updateMetadata(action.episode))
    .map(updateChromeMetadatAction);

/**
 * On Theme change epic
 */
export const onThemeChangeEpic: Epic<Actions, State> = (action$, store) =>
  action$.ofType(CHANGE_THEME)
    .do(() => fixGlobalStyles(store.getState().app.theme))
    .do(() => Storage.saveAppState(store.getState().app))
    .map(noop);

/**
 * App reducer
 */
export const app = (state: AppState = {
  mode: 'dark',
  theme: ThemeProvider('dark'),
},                  action: AppActions): AppState => {
  switch (action.type) {
    case CHANGE_THEME:
      return {...state, mode: action.mode, theme: ThemeProvider(action.mode)};
    default:
      return state;
  }
};
