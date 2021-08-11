import { createContext } from 'react';
import { ThemeMode } from '../../types';
import { getValue } from '../storage/storage';

type ThemeContextValue = {
  theme: ThemeMode;
  changeTheme: (theme: ThemeMode) => void;
};

export const ThemeContext = createContext<ThemeContextValue>({
  theme: getValue('themeMode') || 'dark',
  // eslint-disable-next-line @typescript-eslint/no-empty-function
  changeTheme: () => {},
});

ThemeContext.displayName = 'ThemeContext';
