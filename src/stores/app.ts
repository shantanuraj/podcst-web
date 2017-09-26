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

export type AppActions =
  UpdateChromeMetadataAction |
  ChangeThemeAction;

/**
 * App specific state
 */
export interface AppState {
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
 * App reducer
 */
export const app = (state: AppState = {
  theme: ThemeProvider('default'),
}, action: AppActions): AppState => {
  switch (action.type) {
    case CHANGE_THEME:
      return { ...state, theme: ThemeProvider(action.mode) };
    default:
      return state;
  }
}
