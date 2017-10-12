/**
 * Redux store root entities
 */

import {
  combineEpics,
  Epic,
} from 'redux-observable';

import {
  combineReducers,
} from 'redux';

import {
  INoopAction,
} from './utils';

import {
  IRouterState,
  router,
  RouterActions,
  routerEpic,
} from './router';

import {
  getEpisodesEpic,
  IPodcastsState,
  podcasts,
  PodcastsAction,
} from './podcasts';

import {
  IPlayerState,
  manualSeekUpdateEpic,
  player,
  PlayerActions,
  playerAudioEpic,
  seekUpdateEpic,
} from './player';

import {
  feed,
  FeedActions,
  getFeedEpic,
  IFeedState,
} from './feed';

import {
  ISearchState,
  search,
  SearchActions,
  searchPodcastsEpic,
} from './search';

import {
  ISubscriptionsState,
  parseOPMLEpic,
  subscriptions,
  SubscriptionsActions,
  subscriptionStateChangeEpic,
} from './subscriptions';

import {
  app,
  AppActions,
  chromeMediaMetadaUpdateEpic,
  IAppState,
  onThemeChangeEpic,
} from './app';

import {
  dismissToastEpic,
  IToastState,
  toast,
  ToastActions,
} from './toast';

import {
  changeThemeEpic,
  playerControlsEpic,
  settingsShortcutEpic,
} from './keyboard';

/**
 * Combined application actions interface
 */
export type Actions =
  RouterActions |
  FeedActions |
  SearchActions |
  PodcastsAction |
  PlayerActions |
  SubscriptionsActions |
  AppActions |
  ToastActions |
  INoopAction;

/**
 * Combined application state interface
 */
export interface IState {
  app: IAppState;
  router: IRouterState;
  feed: IFeedState;
  search: ISearchState;
  podcasts: IPodcastsState;
  player: IPlayerState;
  subscriptions: ISubscriptionsState;
  toast: IToastState;
}

const epics = [
  routerEpic,
  getFeedEpic,
  searchPodcastsEpic,
  getEpisodesEpic,
  playerAudioEpic,
  seekUpdateEpic,
  manualSeekUpdateEpic,
  parseOPMLEpic,
  subscriptionStateChangeEpic,
  changeThemeEpic,
  onThemeChangeEpic,
  ('mediaSession' in navigator) ? chromeMediaMetadaUpdateEpic : null,
  playerControlsEpic,
  settingsShortcutEpic,
  dismissToastEpic,
].filter((epic) => epic !== null);

export const rootEpic = combineEpics<Actions, IState>(
  ...(epics as Array<Epic<Actions, IState, any>>),
);

export const rootReducer = combineReducers<IState>({
  app,
  feed,
  player,
  podcasts,
  router,
  search,
  subscriptions,
  toast,
});
