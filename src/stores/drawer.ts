/**
 * Drawer actions / state
 */

import { fromEvent, merge } from 'rxjs';

import { filter, map, switchMap } from 'rxjs/operators';

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
export const drawerCloseEpic: Epic<DrawerActions, ICloseDrawerAction, IState> = (action$, state$) =>
  action$
    .ofType(TOGGLE_DRAWER)
    .pipe(
      switchMap(() =>
        merge(
          fromEvent<MouseEvent>(document, 'mouseup'),
          fromEvent<KeyboardEvent>(document, 'keyup').pipe(filter(e => e.keyCode === Keys.escape)),
        ).pipe(filter(() => state$.value.drawer.isVisible), map(closeDrawer)),
      ),
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
