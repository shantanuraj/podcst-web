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

/**
 * Action creator for navigating between routes
 */
interface INavigateAction {
  type: 'NAVIGATE';
  route: string;
}
const NAVIGATE: INavigateAction['type'] = 'NAVIGATE';
export const navigate = (route: string): INavigateAction => ({
  type: NAVIGATE,
  route,
});

/**
 * Props from Match component of preact-router
 */
export interface IMatchProps {
  url: string;
  path: string;
  matches: boolean;
}

/**
 * Router Navigate action to keep router state in sync
 */
interface IRouterNavigateAction {
  type: 'ROUTER_NAVIGATE';
  route: string;
}
const ROUTER_NAVIGATE: IRouterNavigateAction['type'] = 'ROUTER_NAVIGATE';
export const routerNavigate = (route: string): IRouterNavigateAction => ({
  type: ROUTER_NAVIGATE,
  route,
});

/**
 * Action creator for completing navigation
 */
interface INavigationCompleteAction {
  type: 'NAVIGATION_COMPLETE';
  route: string;
}
const NAVIGATION_COMPLETE: INavigationCompleteAction['type'] = 'NAVIGATION_COMPLETE';
const navigationComplete = (route: string): INavigationCompleteAction => ({
  type: NAVIGATION_COMPLETE,
  route,
});

export type RouterActions =
  INavigateAction |
  IRouterNavigateAction |
  INavigationCompleteAction;

/**
 * Router specific state
 */
export interface IRouterState {
  path: string;
}

/**
 * Router navigation epic
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
    case ROUTER_NAVIGATE:
      return { ...state, path: action.route };
    default:
      return state;
  }
};
