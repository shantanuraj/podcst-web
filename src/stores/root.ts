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
  AuthActions,
  AuthState,
  auth,
  fetchAuthEpic,
  authFulfilledEpic,
} from './auth';

import {
  RouterActions,
  RouterState,
  router,
  routerEpic,
} from './router';

import {
  TextsActions,
  TextsState,
  texts,
  fetchTextsEpic,
  searchTextsEpic,
} from './texts';

/**
 * Combined application actions interface
 */
export type Actions =
  AuthActions |
  RouterActions |
  TextsActions;

/**
 * Combined application state interface
 */
export interface State {
  auth: AuthState;
  router: RouterState;
  texts: TextsState;
};

export const getDefaultState = (): State => ({
  auth: {
    authorized: false,
    code: '',
    host: '',
  },
  router: {
    path: '/',
  },
  texts: {
    loading: false,
    texts: [],
    threads: [],
    filteredThreads: [],
    query: '',
  }
});

export const rootEpic = combineEpics<Actions, State>(
  authFulfilledEpic,
  fetchAuthEpic,
  fetchTextsEpic,
  routerEpic,
  searchTextsEpic,
);

export const rootReducer = combineReducers<State>({
  auth,
  router,
  texts,
});
