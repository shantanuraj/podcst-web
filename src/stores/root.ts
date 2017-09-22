/**
 * Redux store root entities
 */

import {
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

/**
 * Combined application actions interface
 */
export type Actions =
  NoopAction |
  RouterActions |
  FeedActions |
  SearchActions |
  PodcastsAction |
  PlayerActions |
  SubscriptionsActions;

/**
 * Combined application state interface
 */
export interface State {
  router: RouterState;
  feed: FeedState;
  search: SearchState;
  podcasts: PodcastsState;
  player: PlayerState;
  subscriptions: SubscriptionsState;
};

export const rootEpic = combineEpics<Actions, State>(
  routerEpic,
  getFeedEpic,
  searchPodcastsEpic,
  getEpisodesEpic,
  playerAudioEpic,
  seekUpdateEpic,
  manualSeekUpdateEpic,
  parseOPMLEpic,
  subscriptionStateChangeEpic,
);

export const rootReducer = combineReducers<State>({
  router,
  feed,
  search,
  podcasts,
  player,
  subscriptions,
});
