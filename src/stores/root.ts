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

/**
 * Combined application actions interface
 */
export type Actions =
  RouterActions;

/**
 * Combined application state interface
 */
export interface State {
  router: RouterState;
};

export const getDefaultState = (): State => ({
  router: {
    path: '/',
  },
});

export const rootEpic = combineEpics<Actions, State>(
  routerEpic,
);

export const rootReducer = combineReducers<State>({
  router,
});
