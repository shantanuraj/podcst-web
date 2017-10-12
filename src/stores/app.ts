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
  IState,
} from './root';

import {
  IPlayEpisodeAction,
  PLAY_EPISODE,
} from './player';

import {
  noop,
} from './utils';

interface IUpdateChromeMetadataAction {
  type: 'UPDATE_CHROME_METADATA';
}
const UPDATE_CHROME_METADATA: IUpdateChromeMetadataAction['type'] = 'UPDATE_CHROME_METADATA';
const updateChromeMetadatAction = (): IUpdateChromeMetadataAction => ({
  type: UPDATE_CHROME_METADATA,
});

type ChangeTheme = 'CHANGE_THEME';
interface IChangeThemeAction {
  type: ChangeTheme;
  mode: App.ThemeMode;
}
const CHANGE_THEME: IChangeThemeAction['type'] = 'CHANGE_THEME';
export const changeTheme = (mode: App.ThemeMode): IChangeThemeAction => ({
  type: CHANGE_THEME,
  mode,
});

type AppInit = 'APP_INIT';
interface IAppInitAction {
  type: AppInit;
}
export const APP_INIT: IAppInitAction['type'] = 'APP_INIT';
export const appInit = (): IAppInitAction => ({
  type: APP_INIT,
});

export type AppActions =
  IAppInitAction |
  IUpdateChromeMetadataAction |
  IChangeThemeAction;

/**
 * App specific state
 */
export interface IAppState {
  mode: App.ThemeMode;
  theme: App.Theme;
}

/**
 * Chrome MediaSession Metadata epic
 */
export const chromeMediaMetadaUpdateEpic: Epic<Actions, IState> = (action$, store) =>
  action$.ofType(PLAY_EPISODE)
    .do((action: IPlayEpisodeAction) => updateMetadata(
      action.episode,
      (
        store.getState().podcasts[action.episode.feed] &&
        store.getState().podcasts[action.episode.feed].episodes
      ) || null,
    ))
    .map(updateChromeMetadatAction);

/**
 * On Theme change epic
 */
export const onThemeChangeEpic: Epic<Actions, IState> = (action$, store) =>
  action$.ofType(CHANGE_THEME)
    .do(() => fixGlobalStyles(store.getState().app.theme))
    .do(() => Storage.saveAppState(store.getState().app))
    .map(noop);

/**
 * App reducer
 */
export const app = (state: IAppState = {
  mode: 'dark',
  theme: ThemeProvider('dark'),
},                  action: AppActions): IAppState => {
  switch (action.type) {
    case CHANGE_THEME:
      return {...state, mode: action.mode, theme: ThemeProvider(action.mode)};
    default:
      return state;
  }
};
