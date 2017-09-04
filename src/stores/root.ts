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
} from './subscriptions';

/**
 * Combined application actions interface
 */
export type Actions =
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

export const getDefaultState = (): State => ({
  router: {
    path: '/',
  },
  feed: {
    top: {
      loading: false,
      podcasts: [],
    },
  },
  search: {
    podcasts: [],
    query: '',
    searching: false,
  },
  podcasts: {},
  player: {
    currentEpisode: 0,
    queue: [],
    state: 'stopped',
    seekPosition: 0,
    duration: 0,
  },
  subscriptions: {
    subs: {},
  },
});

export const rootEpic = combineEpics<Actions, State>(
  routerEpic,
  getFeedEpic,
  searchPodcastsEpic,
  getEpisodesEpic,
  playerAudioEpic,
  seekUpdateEpic,
  manualSeekUpdateEpic,
  parseOPMLEpic,
);

export const rootReducer = combineReducers<State>({
  router,
  feed,
  search,
  podcasts,
  player,
  subscriptions,
});
