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
  SearchActions;

/**
 * Combined application state interface
 */
export interface State {
  router: RouterState;
  feed: FeedState;
  search: SearchState;
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
});

export const rootEpic = combineEpics<Actions, State>(
  routerEpic,
  getFeedEpic,
  searchPodcastsEpic,
);

export const rootReducer = combineReducers<State>({
  router,
  feed,
  search,
});
