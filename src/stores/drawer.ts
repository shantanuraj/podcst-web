/**
 * Drawer actions / state
 */

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
