/**
 * Theme provider
 */

import darkTheme from './theme-dark';
import lightTheme from './theme-light';

export const ThemeProvider = (mode: App.ThemeMode): App.Theme => {
  if (mode === 'light') {
    return lightTheme;
  } else {
    return darkTheme;
  }
};
