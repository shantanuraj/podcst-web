/**
 * App state
 * Theme actions / reducers
 * Manage Chrome for Android's media session state
 */

import { Epic } from 'redux-observable';

import { filter, map, tap } from 'rxjs/operators';

import { bindActionCreators, Dispatch } from 'redux';

import { updateMetadata } from '../utils/chrome-media-utils';

import { fixGlobalStyles } from '../utils/styles';

import { Storage } from '../utils/storage';

import { ThemeProvider } from '../styles';

import { Actions, IState } from './root';

import { IPlayEpisodeAction, jumpSeek, pauseEpisode, PLAY_EPISODE, PlayerActions, resumeEpisode } from './player';

import { INoopAction, noop } from './utils';

import { App } from '../typings';

/**
 * Update chrome metadata action creator
 */
interface IUpdateChromeMetadataAction {
  type: 'UPDATE_CHROME_METADATA';
}
const UPDATE_CHROME_METADATA: IUpdateChromeMetadataAction['type'] = 'UPDATE_CHROME_METADATA';
const updateChromeMetadatAction = (): IUpdateChromeMetadataAction => ({
  type: UPDATE_CHROME_METADATA,
});

/**
 * Change theme action creator
 */
type ChangeTheme = 'CHANGE_THEME';
export interface IChangeThemeAction {
  type: ChangeTheme;
  mode: App.ThemeMode;
}
const CHANGE_THEME: IChangeThemeAction['type'] = 'CHANGE_THEME';
export const changeTheme = (mode: App.ThemeMode): IChangeThemeAction => ({
  type: CHANGE_THEME,
  mode,
});

/**
 * Set title action creator
 */
type SetTitle = 'SET_TITLE';
export interface ISetTitleAction {
  type: SetTitle;
  title: string;
}
const SET_TITLE: ISetTitleAction['type'] = 'SET_TITLE';
export const setTitle = (title: string): ISetTitleAction => ({
  type: SET_TITLE,
  title,
});

/**
 * App init action creator
 */
type AppInit = 'APP_INIT';
interface IAppInitAction {
  type: AppInit;
}
export const APP_INIT: IAppInitAction['type'] = 'APP_INIT';
export const appInit = (): IAppInitAction => ({
  type: APP_INIT,
});

export type AppActions = IAppInitAction | IUpdateChromeMetadataAction | IChangeThemeAction | ISetTitleAction;

/**
 * App specific state
 */
export interface IAppState {
  mode: App.ThemeMode;
  theme: App.ITheme;
  title: string;
}

/**
 * Chrome MediaSession Metadata epic
 */
export const chromeMediaMetadaUpdateEpic: (
  dispatch: Dispatch<PlayerActions>,
) => Epic<Actions, IUpdateChromeMetadataAction, IState> = dispatch => (action$, state$) =>
  action$.ofType(PLAY_EPISODE).pipe(
    tap((action: IPlayEpisodeAction) => {
      const { podcasts } = state$.value;

      const info = (podcasts[action.episode.feed] && podcasts[action.episode.feed].episodes) || null;

      const actions = bindActionCreators(
        {
          pause: pauseEpisode,
          resume: resumeEpisode,
          seekBack: () => jumpSeek('seek-back'),
          seekForward: () => jumpSeek('seek-forward'),
        },
        dispatch,
      );

      updateMetadata(action.episode, info, actions.pause, actions.resume, actions.seekBack, actions.seekForward);
    }),
    map(updateChromeMetadatAction),
  );

/**
 * Update title side-effects epic
 */
export const updateTitleEpic: Epic<Actions, INoopAction, IState> = action$ =>
  action$.ofType(SET_TITLE).pipe(tap((action: ISetTitleAction) => (document.title = action.title)), map(noop));

/**
 * On Theme change epic
 */
export const fixGlobalThemeEpic: Epic<Actions, INoopAction, IState> = (action$, state$) =>
  action$.ofType(CHANGE_THEME).pipe(tap(() => fixGlobalStyles(state$.value.app.theme)), map(noop));

/**qq
 * App state storage epic
 */
export const saveAppStateEpic: Epic<Actions, INoopAction, IState> = (action$, state$) =>
  action$.pipe(
    filter(action => action.type === CHANGE_THEME || action.type === SET_TITLE),
    tap(() => Storage.saveAppState(state$.value.app)),
    map(noop),
  );

/**
 * App reducer
 */
export const app = (
  state: IAppState = {
    mode: 'dark',
    theme: ThemeProvider('dark'),
    title: 'Podcst',
  },
  action: AppActions,
): IAppState => {
  switch (action.type) {
    case CHANGE_THEME:
      return { ...state, mode: action.mode, theme: ThemeProvider(action.mode) };
    case SET_TITLE:
      return { ...state, title: action.title };
    default:
      return state;
  }
};
