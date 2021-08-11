import { useCallback, useEffect } from 'react';
import { ThemeMode } from '../../types';
import { shortcuts } from '../keyboard/shortcuts';
import { useKeydown } from '../keyboard/useKeydown';
import { useStorage } from '../storage/useStorage';
import { ThemeContext } from './context';

export const ThemeProvider: React.FC = ({ children }) => {
  const [theme, changeTheme] = useStorage('themeMode', 'dark');
  const cycleTheme = useCallback(() => {
    changeTheme((theme) => (theme === 'dark' ? 'light' : 'dark'));
  }, [changeTheme]);

  useKeydown(shortcuts.theme, cycleTheme);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (theme === 'light') document.documentElement.classList.add('light');
    else document.documentElement.classList.remove('light');
  }, [theme]);

  return (
    <ThemeContext.Provider value={{ theme: theme as ThemeMode, changeTheme }}>
      {children}
    </ThemeContext.Provider>
  );
};
