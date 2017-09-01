/**
 * Router actions / reducers
 */

import {
  Epic,
} from 'redux-observable';

import {
  route as routeTo,
} from 'preact-router';

import {
  State,
} from '../stores/root';

type Navigate = 'NAVIGATE';
const NAVIGATE: Navigate = 'NAVIGATE';
interface NavigateAction {
  type: Navigate;
  route: string;
}

/**
 * Action creator for navigating between routes
 */
export const navigate = (route: string): NavigateAction => ({
  type: NAVIGATE,
  route,
});

type NavigationComplete = 'NAVIGATION_COMPLETE';
const NAVIGATION_COMPLETE: NavigationComplete = 'NAVIGATION_COMPLETE';
interface NavigationCompleteAction {
  type: NavigationComplete;
  route: string;
}

/**
 * Action creator for navigating between routes
 */
const navigationComplete = (route: string): NavigationCompleteAction => ({
  type: NAVIGATION_COMPLETE,
  route,
});

export type RouterActions =
  NavigateAction |
  NavigationCompleteAction;

/**
 * Router specific state
 */
export interface RouterState {
  path: string;
}

/**
 * Fetch texts epic
 */
export const routerEpic: Epic<RouterActions, State> = action$ =>
  action$.ofType(NAVIGATE)
    .map(action => action.route)
    .map(route => {
      routeTo(route);
      return navigationComplete(route);
    });

/**
 * Router reducer
 */
export const router = (state: RouterState = {
  path: '/',
}, action: RouterActions): RouterState => {
  switch (action.type) {
    case NAVIGATE:
      return { ...state, path: action.route };
    default:
      return state;
  }
}
