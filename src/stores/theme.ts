/**
 * Theme actions / reducers
 */

import {
  ThemeProvider,
} from '../styles';

type ChangeTheme = 'CHANGE_THEME';
interface ChangeThemeAction {
  type: ChangeTheme,
  mode: App.ThemeMode,
}
const CHANGE_THEME: ChangeThemeAction['type'] = 'CHANGE_THEME';
export const changeTheme = (mode: App.ThemeMode): ChangeThemeAction => ({
  type: CHANGE_THEME,
  mode,
});

export type ThemeActions =
  ChangeThemeAction;

/**
 * Theme specific state
 */
export interface ThemeState {
  theme: App.Theme;
}

/**
 * Theme reducer
 */
export const theme = (state: ThemeState = {
  theme: ThemeProvider('default'),
}, action: ThemeActions): ThemeState => {
  switch (action.type) {
    case CHANGE_THEME:
      return { ...state, theme: ThemeProvider(action.mode) };
    default:
      return state;
  }
}
