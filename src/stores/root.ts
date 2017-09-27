/**
 * Redux store root entities
 */

import {
  Epic,
  combineEpics,
} from 'redux-observable';

import {
  combineReducers,
} from 'redux';

import {
  NoopAction,
} from './utils';

import {
  RouterActions,
  RouterState,
  router,
  routerEpic,
} from './router';

import {
  PodcastsAction,
  PodcastsState,
  podcasts,
  getEpisodesEpic,
} from './podcasts';

import {
  PlayerActions,
  PlayerState,
  player,
  manualSeekUpdateEpic,
  playerAudioEpic,
  seekUpdateEpic,
} from './player';

import {
  FeedActions,
  FeedState,
  feed,
  getFeedEpic,
} from './feed';

import {
  SearchActions,
  SearchState,
  search,
  searchPodcastsEpic,
} from './search';

import {
  SubscriptionsActions,
  SubscriptionsState,
  subscriptions,
  parseOPMLEpic,
  subscriptionStateChangeEpic,
} from './subscriptions';

import {
  AppActions,
  AppState,
  app,
  chromeMediaMetadaUpdateEpic,
  onThemeChangeEpic,
} from './app';

import {
  changeThemeEpic,
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
  NoopAction;

/**
 * Combined application state interface
 */
export interface State {
  app: AppState;
  router: RouterState;
  feed: FeedState;
  search: SearchState;
  podcasts: PodcastsState;
  player: PlayerState;
  subscriptions: SubscriptionsState;
};

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
].filter(epic => epic !== null);

export const rootEpic = combineEpics<Actions, State>(
  ...(epics as Epic<Actions, State, any>[])
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
