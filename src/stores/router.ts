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
  IState,
} from '../stores/root';

type Navigate = 'NAVIGATE';
const NAVIGATE: Navigate = 'NAVIGATE';
interface INavigateAction {
  type: Navigate;
  route: string;
}

/**
 * Action creator for navigating between routes
 */
export const navigate = (route: string): INavigateAction => ({
  type: NAVIGATE,
  route,
});

type NavigationComplete = 'NAVIGATION_COMPLETE';
const NAVIGATION_COMPLETE: NavigationComplete = 'NAVIGATION_COMPLETE';
interface INavigationCompleteAction {
  type: NavigationComplete;
  route: string;
}

/**
 * Action creator for navigating between routes
 */
const navigationComplete = (route: string): INavigationCompleteAction => ({
  type: NAVIGATION_COMPLETE,
  route,
});

export type RouterActions =
  INavigateAction |
  INavigationCompleteAction;

/**
 * Router specific state
 */
export interface IRouterState {
  path: string;
}

/**
 * Fetch texts epic
 */
export const routerEpic: Epic<RouterActions, IState> = (action$) =>
  action$.ofType(NAVIGATE)
    .map((action) => action.route)
    .do(routeTo)
    .map(navigationComplete);

/**
 * Router reducer
 */
export const router = (
  state: IRouterState = {
    path: '/',
  },
  action: RouterActions,
): IRouterState => {
  switch (action.type) {
    case NAVIGATE:
      return { ...state, path: action.route };
    default:
      return state;
  }
};
