/**
 * Theme provider
 */

import { App } from '../typings';
import darkTheme from './theme-dark';
import lightTheme from './theme-light';

export const ThemeProvider = (mode: App.ThemeMode): App.ITheme => {
  if (mode === 'light') {
    return lightTheme;
  } else {
    return darkTheme;
  }
};
