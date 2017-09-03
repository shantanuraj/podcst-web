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

/**
 * Combined application actions interface
 */
export type Actions =
  RouterActions |
  FeedActions |
  SearchActions |
  PodcastsAction;

/**
 * Combined application state interface
 */
export interface State {
  router: RouterState;
  feed: FeedState;
  search: SearchState;
  podcasts: PodcastsState;
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
});

export const rootEpic = combineEpics<Actions, State>(
  routerEpic,
  getFeedEpic,
  searchPodcastsEpic,
  getEpisodesEpic,
);

export const rootReducer = combineReducers<State>({
  router,
  feed,
  search,
  podcasts,
});
