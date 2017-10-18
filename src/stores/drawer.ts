/**
 * Drawer actions / state
 */

import { Observable } from 'rxjs/Observable';

import { Epic } from 'redux-observable';

import { Keys } from '../utils/constants';

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
 * Action creator for drawer close
 */
interface ICloseDrawerAction {
  type: 'CLOSE_DRAWER';
}
const CLOSE_DRAWER: ICloseDrawerAction['type'] = 'CLOSE_DRAWER';
export const closeDrawer = (): ICloseDrawerAction => ({
  type: CLOSE_DRAWER,
});

/**
 * Drawer actions
 */
export type DrawerActions = IToggleDrawerAction | ICloseDrawerAction;

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
    Observable.merge(
      Observable.fromEvent<MouseEvent>(document, 'mouseup'),
      Observable.fromEvent<KeyboardEvent>(document, 'keyup').filter(e => e.keyCode === Keys.escape),
    )
      .filter(() => store.getState().drawer.isVisible)
      .map(closeDrawer),
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
    case CLOSE_DRAWER:
      return { ...state, isVisible: false };
    case TOGGLE_DRAWER:
      return { ...state, isVisible: !state.isVisible };
    default:
      return state;
  }
};
