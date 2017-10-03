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
  router,
  RouterActions,
  routerEpic,
  IRouterState,
} from './router';

import {
  getEpisodesEpic,
  podcasts,
  PodcastsAction,
  IPodcastsState,
} from './podcasts';

import {
  manualSeekUpdateEpic,
  player,
  PlayerActions,
  playerAudioEpic,
  IPlayerState,
  seekUpdateEpic,
} from './player';

import {
  feed,
  FeedActions,
  IFeedState,
  getFeedEpic,
} from './feed';

import {
  search,
  SearchActions,
  searchPodcastsEpic,
  ISearchState,
} from './search';

import {
  parseOPMLEpic,
  subscriptions,
  SubscriptionsActions,
  ISubscriptionsState,
  subscriptionStateChangeEpic,
} from './subscriptions';

import {
  app,
  AppActions,
  IAppState,
  chromeMediaMetadaUpdateEpic,
  onThemeChangeEpic,
} from './app';

import {
  changeThemeEpic,
  playerControlsEpic,
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
  INoopAction;

/**
 * Combined application state interface
 */
export interface State {
  app: IAppState;
  router: IRouterState;
  feed: IFeedState;
  search: ISearchState;
  podcasts: IPodcastsState;
  player: IPlayerState;
  subscriptions: ISubscriptionsState;
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
].filter((epic) => epic !== null);

export const rootEpic = combineEpics<Actions, State>(
  ...(epics as Array<Epic<Actions, State, any>>),
);

export const rootReducer = combineReducers<State>({
  app,
  router,
  feed,
  search,
  podcasts,
  player,
  subscriptions,
});
