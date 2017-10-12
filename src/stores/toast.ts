/**
 * Toast actions / reducers
 */

import {
  Epic,
} from 'redux-observable';

import {
  IState,
} from '../stores/root';

/**
 * Default toast dismiss duration in ms
 */
const DISMISS_TOAST_AFTER = 4000;

/**
 * Action creator for showing toast
 */
interface IShowToastAction {
  type: 'SHOW_TOAST';
  message: string;
  persistent: boolean;
}
const SHOW_TOAST: IShowToastAction['type'] = 'SHOW_TOAST';
export const showToast = (
  message: string,
  persistent: boolean = false,
): IShowToastAction => ({
  type: SHOW_TOAST,
  message,
  persistent,
});

/**
 * Action creator for dismissing toast
 */
interface IDismissToastAction {
  type: 'DISMISS_TOAST';
}
const DISMISS_TOAST: IDismissToastAction['type'] = 'DISMISS_TOAST';
export const dismissToast = (): IDismissToastAction => ({
  type: DISMISS_TOAST,
});

export type ToastActions =
  IShowToastAction |
  IDismissToastAction;

/**
 * Toast specific state
 */
export interface IToastState {
  isVisible: boolean;
  message: string | null;
  persistent: boolean;
}

/**
 * Dismiss toast epic
 */
export const dismissToastEpic: Epic<ToastActions, IState> = (action$) =>
  action$
    .filter((action) => (action.type === SHOW_TOAST && !action.persistent))
    .debounceTime(DISMISS_TOAST_AFTER)
    .map(dismissToast);

/**
 * Toast reducer
 */
export const toast = (
  state: IToastState = {
    isVisible: false,
    message: null,
    persistent: false,
  },
  action: ToastActions,
): IToastState => {
  switch (action.type) {
    case SHOW_TOAST:
      return {...state, message: action.message, persistent: action.persistent, isVisible: true};
    case DISMISS_TOAST:
      return {...state, message: null, persistent: false, isVisible: false};
    default:
      return state;
  }
};
