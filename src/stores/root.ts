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
  NoopAction,
} from './utils';

import {
  router,
  RouterActions,
  routerEpic,
  RouterState,
} from './router';

import {
  getEpisodesEpic,
  podcasts,
  PodcastsAction,
  PodcastsState,
} from './podcasts';

import {
  manualSeekUpdateEpic,
  player,
  PlayerActions,
  playerAudioEpic,
  PlayerState,
  seekUpdateEpic,
} from './player';

import {
  feed,
  FeedActions,
  FeedState,
  getFeedEpic,
} from './feed';

import {
  search,
  SearchActions,
  searchPodcastsEpic,
  SearchState,
} from './search';

import {
  parseOPMLEpic,
  subscriptions,
  SubscriptionsActions,
  SubscriptionsState,
  subscriptionStateChangeEpic,
} from './subscriptions';

import {
  app,
  AppActions,
  AppState,
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
