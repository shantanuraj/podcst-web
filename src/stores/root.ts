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

/**
 * Combined application actions interface
 */
export type Actions =
  RouterActions |
  FeedActions;

/**
 * Combined application state interface
 */
export interface State {
  router: RouterState;
  feed: FeedState;
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
});

export const rootEpic = combineEpics<Actions, State>(
  routerEpic,
  getFeedEpic,
);

export const rootReducer = combineReducers<State>({
  router,
  feed,
});
