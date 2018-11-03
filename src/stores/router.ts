/**
 * Router actions / reducers
 */

import { Epic } from 'redux-observable';
import { filter, map, tap } from 'rxjs/operators';

import { routeTo } from '../utils/history';

import { Actions, IState } from './root';

import { getTitle } from '../utils/route-titles';
import { ISetTitleAction, setTitle } from './app';

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

export type RouterActions = INavigateAction | IRouterNavigateAction | INavigationCompleteAction;

/**
 * Router specific state
 */
export interface IRouterState {
  path: string;
}

/**
 * Router navigation epic
 */
export const routerEpic: Epic<RouterActions, INavigationCompleteAction, IState> = action$ =>
  action$.ofType(NAVIGATE).pipe(map(action => action.route), tap(routeTo), map(navigationComplete));

/**
 * Route title sync epic
 */
export const routeTitleSyncEpic: Epic<Actions, ISetTitleAction, IState> = action$ =>
  action$.pipe(
    filter(action => action.type === NAVIGATE || action.type === ROUTER_NAVIGATE),
    map(({ route }: INavigateAction | IRouterNavigateAction) => setTitle(getTitle(route))),
  );

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
