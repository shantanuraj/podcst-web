/**
 * Drawer actions / state
 */

import { Observable } from 'rxjs/Observable';

import { Epic } from 'redux-observable';

import { IState } from './root';

/**
 * Action creator for drawer toggle
 */
interface IToggleDrawerAction {
  type: 'TOGGLE_DRAWER';
}
const TOGGLE_DRAWER: IToggleDrawerAction['type'] = 'TOGGLE_DRAWER';
export const toggleDrawer = (): IToggleDrawerAction => ({
  type: TOGGLE_DRAWER,
});

/**
 * Drawer actions
 */
export type DrawerActions = IToggleDrawerAction;

/**
 * Drawer specific state
 */
export interface IDrawerState {
  isVisible: boolean;
}

/**
 * Drawer close epic
 */
export const drawerCloseEpic: Epic<DrawerActions, IState> = (action$, store) =>
  action$.ofType(TOGGLE_DRAWER).switchMap(() =>
    Observable.fromEvent<MouseEvent>(document, 'mouseup')
      .filter(() => store.getState().drawer.isVisible)
      .map(toggleDrawer),
  );

/**
 * Drawer reducer
 */
export const drawer = (
  state: IDrawerState = {
    isVisible: false,
  },
  action: DrawerActions,
): IDrawerState => {
  switch (action.type) {
    case TOGGLE_DRAWER:
      return { ...state, isVisible: !state.isVisible };
    default:
      return state;
  }
};
