/**
 * App state
 * Theme actions / reducers
 * Manage Chrome for Android's media session state
 */

import { Epic } from 'redux-observable';

import { bindActionCreators } from 'redux';

import { updateMetadata } from '../utils/chrome-media-utils';

import { fixGlobalStyles } from '../utils/styles';

import { Storage } from '../utils/storage';

import { ThemeProvider } from '../styles';

import { Actions, IState } from './root';

import { IPlayEpisodeAction, jumpSeek, pauseEpisode, PLAY_EPISODE, resumeEpisode } from './player';

import { noop } from './utils';

interface IUpdateChromeMetadataAction {
  type: 'UPDATE_CHROME_METADATA';
}
const UPDATE_CHROME_METADATA: IUpdateChromeMetadataAction['type'] = 'UPDATE_CHROME_METADATA';
const updateChromeMetadatAction = (): IUpdateChromeMetadataAction => ({
  type: UPDATE_CHROME_METADATA,
});

interface IShowInfoModalAction {
  type: 'SHOW_INFO_MODAL';
}
const SHOW_INFO_MODAL: IShowInfoModalAction['type'] = 'SHOW_INFO_MODAL';
export const showModal = (): IShowInfoModalAction => ({
  type: SHOW_INFO_MODAL,
});

interface ICloseInfoModalAction {
  type: 'CLOSE_INFO_MODAL';
}
const CLOSE_INFO_MODAL: ICloseInfoModalAction['type'] = 'CLOSE_INFO_MODAL';
export const closeModal = (): ICloseInfoModalAction => ({
  type: CLOSE_INFO_MODAL,
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
  | IAppInitAction
  | IShowInfoModalAction
  | ICloseInfoModalAction
  | IUpdateChromeMetadataAction
  | IChangeThemeAction;

/**
 * App specific state
 */
export interface IAppState {
  isModalVisible: boolean;
  mode: App.ThemeMode;
  theme: App.ITheme;
}

/**
 * Chrome MediaSession Metadata epic
 */
export const chromeMediaMetadaUpdateEpic: Epic<Actions, IState> = (action$, store) =>
  action$
    .ofType(PLAY_EPISODE)
    .do((action: IPlayEpisodeAction) => {
      const { podcasts } = store.getState();

      const info = (podcasts[action.episode.feed] && podcasts[action.episode.feed].episodes) || null;

      const actions = bindActionCreators(
        {
          pause: pauseEpisode,
          resume: resumeEpisode,
          seekBack: () => jumpSeek('seek-back'),
          seekForward: () => jumpSeek('seek-forward'),
        },
        store.dispatch,
      );

      updateMetadata(action.episode, info, actions.pause, actions.resume, actions.seekBack, actions.seekForward);
    })
    .map(updateChromeMetadatAction);

/**
 * On Theme change epic
 */
export const onThemeChangeEpic: Epic<Actions, IState> = (action$, store) =>
  action$
    .ofType(CHANGE_THEME)
    .do(() => fixGlobalStyles(store.getState().app.theme))
    .do(() => Storage.saveAppState(store.getState().app))
    .map(noop);

/**
 * App reducer
 */
export const app = (
  state: IAppState = {
    isModalVisible: false,
    mode: 'dark',
    theme: ThemeProvider('dark'),
  },
  action: AppActions,
): IAppState => {
  switch (action.type) {
    case CHANGE_THEME:
      return { ...state, mode: action.mode, theme: ThemeProvider(action.mode) };
    case SHOW_INFO_MODAL:
      return { ...state, isModalVisible: true };
    case CLOSE_INFO_MODAL:
      return { ...state, isModalVisible: false };
    default:
      return state;
  }
};
